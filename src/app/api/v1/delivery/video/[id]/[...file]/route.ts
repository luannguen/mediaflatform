import { NextRequest, NextResponse } from 'next/server';
import { assetService } from '@/services/assetService';
import { videoService } from '@/services/videoService';
import { getStorageProvider } from '@/lib/storage/factory';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { authorize } from '@/lib/security/resourceAuthorization';
import { verifyDeliveryGrant, DeliveryGrantPermission } from '@/lib/security/delivery-grant';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; file: string[] | string }> }
) {
  try {
    const { id: assetId, file: rawFile } = await params;
    const fileSegments = Array.isArray(rawFile) ? rawFile : [rawFile];
    const fileName = fileSegments[fileSegments.length - 1].toLowerCase();

    let asset: any = null;
    try {
      asset = await assetService.getAssetGlobally(assetId);
    } catch {
      return new NextResponse('Video asset not found', { status: 404 });
    }

    if (!asset || asset.status === 'deleted' || asset.status === 'trashed') {
      return new NextResponse('Video asset not found', { status: 404 });
    }

    // Must be video asset type
    if (asset.asset_type !== 'video') {
      return NextResponse.json(
        { error: 'NOT_A_VIDEO', message: 'Requested asset is not a video asset' },
        { status: 404 }
      );
    }

    // Quarantined Asset Protection
    if (asset.status === 'quarantined') {
      return NextResponse.json(
        {
          error: 'ASSET_QUARANTINED',
          message: 'This asset is quarantined for security review and cannot be delivered directly',
        },
        {
          status: 403,
          headers: {
            'Cache-Control': 'private, no-cache, no-store, must-revalidate',
            'Referrer-Policy': 'no-referrer',
          },
        }
      );
    }

    const isPrivate = asset.visibility === 'private' || asset.visibility === 'workspace';
    const grantToken = req.nextUrl.searchParams.get('grant');

    // Determine required delivery grant permission based on requested resource
    let requiredPerm: DeliveryGrantPermission | undefined;
    if (fileName === 'poster.webp' || fileName === 'poster.jpg' || fileName === 'poster.png') {
      requiredPerm = 'poster:read';
    } else if (fileName === 'preview.webp' || fileName === 'trailer.webp') {
      requiredPerm = 'preview:read';
    } else if (fileName.endsWith('.m3u8') || fileName.endsWith('.ts') || fileName.endsWith('.m4s')) {
      requiredPerm = 'hls:read';
    }

    // Enforce Tenant-Aware Private Delivery Policy
    if (isPrivate) {
      if (grantToken) {
        // 1. Verify via Delivery Grant
        const grantRes = verifyDeliveryGrant(grantToken, assetId, asset.workspace_id, requiredPerm || 'video:delivery');
        if (!grantRes.valid) {
          const status = 403;
          return NextResponse.json(
            { error: grantRes.code || 'DELIVERY_GRANT_INVALID', message: grantRes.message || 'Delivery grant invalid or expired' },
            {
              status,
              headers: {
                'Cache-Control': 'private, no-cache, no-store, must-revalidate',
                'Referrer-Policy': 'no-referrer',
              },
            }
          );
        }

        // Verify tenant boundary: grant workspace must match asset workspace
        if (grantRes.payload && grantRes.payload.wid !== asset.workspace_id) {
          return NextResponse.json(
            { error: 'DELIVERY_GRANT_FORBIDDEN', message: 'Delivery grant workspace does not match asset workspace' },
            {
              status: 403,
              headers: {
                'Cache-Control': 'private, no-cache, no-store, must-revalidate',
                'Referrer-Policy': 'no-referrer',
              },
            }
          );
        }
      } else {
        // 2. Fallback to HTTP Header Authentication (Bearer token or X-API-Key)
        let principal: any;
        try {
          principal = await authenticateRequest(req, 'assets:read');
        } catch (err: any) {
          if (
            err?.statusCode === 403 ||
            err?.code === 'PERMISSION_DENIED' ||
            err?.code === 'INSUFFICIENT_PERMISSIONS' ||
            err?.code === 'FORBIDDEN'
          ) {
            return NextResponse.json(
              { error: err?.code || 'PERMISSION_DENIED', message: err?.message || 'Forbidden' },
              {
                status: 403,
                headers: {
                  'Cache-Control': 'private, no-cache, no-store, must-revalidate',
                  'Referrer-Policy': 'no-referrer',
                },
              }
            );
          }
          return NextResponse.json(
            { error: 'UNAUTHORIZED', message: 'Unauthorized: Private asset requires valid credentials or delivery grant' },
            {
              status: 401,
              headers: {
                'WWW-Authenticate': 'Bearer',
                'Cache-Control': 'private, no-cache, no-store, must-revalidate',
                'Referrer-Policy': 'no-referrer',
              },
            }
          );
        }

        const auth = authorize(principal, 'asset.read', asset);
        if (!auth.allowed) {
          return NextResponse.json(
            { error: auth.code || 'PERMISSION_DENIED', message: auth.message || 'Forbidden' },
            {
              status: 403,
              headers: {
                'Cache-Control': 'private, no-cache, no-store, must-revalidate',
                'Referrer-Policy': 'no-referrer',
              },
            }
          );
        }
      }
    }

    const baseUrl = new URL(req.url).origin;
    const cacheHeader = isPrivate
      ? 'private, no-cache, no-store, must-revalidate'
      : 'public, max-age=86400, s-maxage=86400, immutable';
    const imageCacheHeader = isPrivate
      ? 'private, no-cache, no-store, must-revalidate'
      : 'public, max-age=31536000, s-maxage=31536000, immutable';

    const baseHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': cacheHeader,
    };
    if (isPrivate) {
      baseHeaders['Referrer-Policy'] = 'no-referrer';
    }

    // 1. Master HLS Playlist
    if (fileName === 'master.m3u8') {
      if (asset.processing_status === 'failed') {
        return NextResponse.json(
          { error: 'PROCESSING_FAILED', message: 'Video processing failed' },
          { status: 410, headers: baseHeaders }
        );
      }
      const playlist = await videoService.generateMasterPlaylist(assetId, baseUrl, asset, grantToken || undefined);
      if (!playlist) {
        if (asset.processing_status === 'pending' || asset.processing_status === 'processing') {
          return NextResponse.json(
            {
              error: 'TOO_EARLY',
              message: 'Video transcoding is in progress. Please poll status or retry later.',
              processing_status: asset.processing_status,
            },
            {
              status: 425,
              headers: { ...baseHeaders, 'Retry-After': '5' },
            }
          );
        }
        if (asset.processing_status === 'ready') {
          return NextResponse.json(
            {
              error: 'MEDIA_ARTIFACT_MISSING',
              message: 'Transcoded master playlist not found in storage. Asset transcoding may be incomplete.',
              processing_status: asset.processing_status,
            },
            {
              status: 503,
              headers: { ...baseHeaders, 'Retry-After': '10' },
            }
          );
        }
        return NextResponse.json(
          { error: 'NOT_FOUND', message: 'Master playlist not found' },
          { status: 404, headers: baseHeaders }
        );
      }
      return new NextResponse(playlist, {
        headers: {
          ...baseHeaders,
          'Content-Type': 'application/vnd.apple.mpegurl',
        },
      });
    }

    // 2. Resolution Variant Playlists (1080p.m3u8, 720p.m3u8, etc.)
    if (fileName.endsWith('.m3u8')) {
      const profileName = fileName.replace('.m3u8', '');
      const variantPlaylist = await videoService.generateVariantPlaylist(
        assetId,
        profileName,
        baseUrl,
        asset,
        grantToken || undefined
      );
      if (!variantPlaylist) {
        if (asset.processing_status === 'pending' || asset.processing_status === 'processing') {
          return new NextResponse('Video transcoding is in progress', { status: 425, headers: baseHeaders });
        }
        if (asset.processing_status === 'ready') {
          return new NextResponse('MEDIA_ARTIFACT_MISSING: Transcoded variant playlist not found in storage', {
            status: 503,
            headers: baseHeaders,
          });
        }
        return new NextResponse('Variant playlist not found', { status: 404, headers: baseHeaders });
      }
      return new NextResponse(variantPlaylist, {
        headers: {
          ...baseHeaders,
          'Content-Type': 'application/vnd.apple.mpegurl',
        },
      });
    }

    // 3. Smart Video Poster Frame
    if (fileName === 'poster.webp' || fileName === 'poster.jpg' || fileName === 'poster.png') {
      const posterBuffer = await videoService.getVideoPoster(asset);
      return new NextResponse(new Uint8Array(posterBuffer), {
        headers: {
          ...baseHeaders,
          'Content-Type': 'image/webp',
          'Cache-Control': imageCacheHeader,
        },
      });
    }

    // 4. 3-Second Animated Hover Preview Trailer
    if (fileName === 'preview.webp' || fileName === 'trailer.webp') {
      const previewBuffer = await videoService.getVideoPreview(asset);
      return new NextResponse(new Uint8Array(previewBuffer), {
        headers: {
          ...baseHeaders,
          'Content-Type': 'image/webp',
          'Cache-Control': imageCacheHeader,
        },
      });
    }

    // 5. Video Segment Chunks (.ts / .m4s) - Decoupled Delivery with 307 Temporary Redirect
    if (fileName.endsWith('.ts') || fileName.endsWith('.m4s')) {
      const storage = getStorageProvider();
      const outputVersion = await videoService.getActiveOutputVersion(asset);

      let profile = '720p';
      let segmentFile = fileName;

      if (fileSegments.length >= 2 && fileSegments[0] !== 'segments') {
        profile = fileSegments[0];
        segmentFile = fileSegments[fileSegments.length - 1];
      } else if (fileName.includes('_')) {
        profile = fileName.split('_')[0];
        segmentFile = fileName.split('_').slice(1).join('_');
      }

      if (outputVersion) {
        const exactStorageKey = `videos/${asset.id}/${outputVersion}/${profile}/${segmentFile}`;
        let redirectUrl: string;
        if (isPrivate) {
          try {
            redirectUrl = await storage.getSignedDownloadUrl(exactStorageKey, 60);
          } catch {
            return new NextResponse('MEDIA_ARTIFACT_MISSING: Private segment not found in storage', {
              status: 503,
              headers: baseHeaders,
            });
          }
        } else {
          redirectUrl = storage.getPublicUrl(exactStorageKey);
        }

        return NextResponse.redirect(redirectUrl, {
          status: 307,
          headers: {
            ...baseHeaders,
            'Cache-Control': isPrivate ? 'private, no-cache, no-store, must-revalidate' : 'public, max-age=31536000, s-maxage=31536000, immutable',
          },
        });
      }

      if (asset.processing_status === 'pending' || asset.processing_status === 'processing') {
        return new NextResponse('Video segment is still processing', { status: 425, headers: baseHeaders });
      }
      if (asset.processing_status === 'ready') {
        return new NextResponse('MEDIA_ARTIFACT_MISSING: Video segment not found in storage', {
          status: 503,
          headers: baseHeaders,
        });
      }

      return new NextResponse('Segment unavailable', { status: 404, headers: baseHeaders });
    }

    return new NextResponse('File format not supported', { status: 400, headers: baseHeaders });
  } catch (error: any) {
    return new NextResponse(`Video streaming error: ${error.message}`, { status: 500 });
  }
}
