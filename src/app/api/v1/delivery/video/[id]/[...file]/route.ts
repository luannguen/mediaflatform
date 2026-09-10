import { NextRequest, NextResponse } from 'next/server';
import { assetService } from '@/services/assetService';
import { videoService } from '@/services/videoService';
import { getStorageProvider } from '@/lib/storage/factory';
import { authenticateRequest } from '@/lib/security/auth-guard';

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

    const isPrivate = asset.visibility === 'private' || asset.visibility === 'workspace';

    // Enforce Tenant-Aware Private Delivery Policy
    if (isPrivate) {
      let principal: any;
      try {
        principal = await authenticateRequest(req, 'assets:read');
      } catch {
        return NextResponse.json(
          { error: 'UNAUTHORIZED', message: 'Unauthorized: Private asset requires valid credentials' },
          {
            status: 401,
            headers: { 'WWW-Authenticate': 'Bearer' },
          }
        );
      }

      // Strict Multi-Tenant Isolation: Tenant A cannot access Tenant B's private media
      if (principal.workspaceId !== asset.workspace_id) {
        return NextResponse.json(
          { error: 'PERMISSION_DENIED', message: 'Forbidden: Cross-workspace access denied' },
          { status: 403 }
        );
      }
    }

    const baseUrl = new URL(req.url).origin;

    // 1. Master HLS Playlist
    if (fileName === 'master.m3u8') {
      if (asset.processing_status === 'failed') {
        return NextResponse.json(
          { error: 'PROCESSING_FAILED', message: 'Video processing failed' },
          { status: 410 }
        );
      }
      const playlist = await videoService.generateMasterPlaylist(assetId, baseUrl, asset);
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
              headers: { 'Retry-After': '5' },
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
              headers: { 'Retry-After': '10' },
            }
          );
        }
        return NextResponse.json(
          { error: 'NOT_FOUND', message: 'Master playlist not found' },
          { status: 404 }
        );
      }
      return new NextResponse(playlist, {
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': isPrivate ? 'private, no-cache' : 'public, max-age=86400, s-maxage=86400, immutable',
        },
      });
    }

    // 2. Resolution Variant Playlists (1080p.m3u8, 720p.m3u8, etc.)
    if (fileName.endsWith('.m3u8')) {
      const profileName = fileName.replace('.m3u8', '');
      const variantPlaylist = await videoService.generateVariantPlaylist(assetId, profileName, baseUrl, asset);
      if (!variantPlaylist) {
        if (asset.processing_status === 'pending' || asset.processing_status === 'processing') {
          return new NextResponse('Video transcoding is in progress', { status: 425 });
        }
        if (asset.processing_status === 'ready') {
          return new NextResponse('MEDIA_ARTIFACT_MISSING: Transcoded variant playlist not found in storage', { status: 503 });
        }
        return new NextResponse('Variant playlist not found', { status: 404 });
      }
      return new NextResponse(variantPlaylist, {
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': isPrivate ? 'private, no-cache' : 'public, max-age=86400, s-maxage=86400, immutable',
        },
      });
    }

    // 3. Smart Video Poster Frame
    if (fileName === 'poster.webp' || fileName === 'poster.jpg' || fileName === 'poster.png') {
      const posterBuffer = await videoService.getVideoPoster(asset);
      return new NextResponse(new Uint8Array(posterBuffer), {
        headers: {
          'Content-Type': 'image/webp',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': isPrivate ? 'private, no-cache' : 'public, max-age=31536000, s-maxage=31536000, immutable',
        },
      });
    }

    // 4. 3-Second Animated Hover Preview Trailer
    if (fileName === 'preview.webp' || fileName === 'trailer.webp') {
      const previewBuffer = await videoService.getVideoPreview(asset);
      return new NextResponse(new Uint8Array(previewBuffer), {
        headers: {
          'Content-Type': 'image/webp',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': isPrivate ? 'private, no-cache' : 'public, max-age=31536000, s-maxage=31536000, immutable',
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
            return new NextResponse('MEDIA_ARTIFACT_MISSING: Private segment not found in storage', { status: 503 });
          }
        } else {
          redirectUrl = storage.getPublicUrl(exactStorageKey);
        }

        return NextResponse.redirect(redirectUrl, {
          status: 307,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': isPrivate ? 'private, no-cache' : 'public, max-age=31536000, s-maxage=31536000, immutable',
          },
        });
      }

      if (asset.processing_status === 'pending' || asset.processing_status === 'processing') {
        return new NextResponse('Video segment is still processing', { status: 425 });
      }
      if (asset.processing_status === 'ready') {
        return new NextResponse('MEDIA_ARTIFACT_MISSING: Video segment not found in storage', { status: 503 });
      }

      return new NextResponse('Segment unavailable', { status: 404 });
    }

    return new NextResponse('File format not supported', { status: 400 });
  } catch (error: any) {
    return new NextResponse(`Video streaming error: ${error.message}`, { status: 500 });
  }
}
