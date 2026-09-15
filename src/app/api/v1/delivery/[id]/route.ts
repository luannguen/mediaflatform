import { withApiRoute } from '@/lib/platform/apiRoute';
import { NextRequest, NextResponse } from 'next/server';
import { assetService } from '@/services/assetService';
import { analyticsService } from '@/services/analyticsService';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { authorize } from '@/lib/security/resourceAuthorization';
import { verifyDeliveryGrant } from '@/lib/security/delivery-grant';
import { getStorageProvider } from '@/lib/storage/factory';
import { getDeliveryPolicy, get304CacheControl } from '@/lib/media/deliveryPolicy';
import {
  validateTransformDimensions,
  getTransformCacheKey,
  findCanonicalVariantMatch,
} from '@/lib/media/transformPolicy';
import sharp from 'sharp';
import crypto from 'crypto';

async function handleGET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();

  try {
    const { id: assetId } = await params;
    const { searchParams } = new URL(req.url);

    let asset: any = null;
    try {
      asset = await assetService.getAssetGlobally(assetId);
    } catch {
      return new NextResponse('Asset not found', { status: 404 });
    }

    if (!asset || asset.status === 'deleted' || asset.status === 'trashed') {
      return new NextResponse('Asset not found', { status: 404 });
    }

    // 1. Quarantined Asset Protection
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
          },
        }
      );
    }

    // 2. Enforce Tenant-Aware Private Delivery Policy & Identity Scope Hardening
    const grantToken = searchParams.get('grant');
    if (asset.visibility === 'private' || asset.visibility === 'workspace') {
      if (grantToken) {
        // 1. Verify via Delivery Grant
        const grantRes = verifyDeliveryGrant(grantToken, assetId, asset.workspace_id, 'asset:read');
        if (!grantRes.valid) {
          return NextResponse.json(
            { error: grantRes.code || 'DELIVERY_GRANT_INVALID', message: grantRes.message || 'Delivery grant invalid or expired' },
            {
              status: 403,
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

    if (asset.status !== 'active' || !['ready','skipped'].includes(asset.processing_status)) return NextResponse.json({ error: 'ASSET_NOT_READY' }, { status: 425, headers: { 'Cache-Control': 'private, no-store', 'Retry-After': '5' } });
    const widthParam = searchParams.get('w') || searchParams.get('width');
    const heightParam = searchParams.get('h') || searchParams.get('height');
    const qualityParam = searchParams.get('q') || searchParams.get('quality');
    const formatParam = (searchParams.get('format') || 'webp').toLowerCase();

    const allowedFits = ['cover', 'contain', 'fill', 'inside', 'outside', 'smart', 'focal'] as const;
    type SharpFit = (typeof allowedFits)[number];
    const rawFit = (searchParams.get('fit') || searchParams.get('crop') || 'cover').toLowerCase();
    const isSmartCrop = rawFit === 'smart' || searchParams.get('crop') === 'smart' || searchParams.get('gravity') === 'attention';
    const isFocalCrop = rawFit === 'focal' || searchParams.get('crop') === 'focal' || searchParams.has('focal_x');

    const queryFocalX = searchParams.get('focal_x');
    const queryFocalY = searchParams.get('focal_y');
    const focalX = queryFocalX !== null ? Math.max(0, Math.min(1, parseFloat(queryFocalX))) : (asset.metadata_json?.focal_point?.x ?? 0.5);
    const focalY = queryFocalY !== null ? Math.max(0, Math.min(1, parseFloat(queryFocalY))) : (asset.metadata_json?.focal_point?.y ?? 0.5);

    const fitParam: SharpFit = (allowedFits as readonly string[]).includes(rawFit)
      ? (rawFit as SharpFit)
      : 'cover';

    const width = widthParam ? parseInt(widthParam, 10) : undefined;
    const height = heightParam ? parseInt(heightParam, 10) : undefined;
    const quality = qualityParam ? Math.min(100, Math.max(1, parseInt(qualityParam, 10))) : 80;

    // 3. Decompression Bomb Prevention
    if (width !== undefined || height !== undefined) {
      try {
        validateTransformDimensions(width, height);
      } catch (err: any) {
        return NextResponse.json(
          { error: err.code || 'DECOMPRESSION_BOMB_PREVENTED', message: err.message },
          { status: 400 }
        );
      }
    }

    // Dynamic watermark params
    const watermarkText = searchParams.get('watermark_text') || searchParams.get('watermark');
    const hasWatermark = Boolean(watermarkText && watermarkText !== 'false' && watermarkText !== '0');
    const watermarkPos = (searchParams.get('watermark_pos') || 'bottom-right').toLowerCase();
    const watermarkOpacity = Math.max(0.1, Math.min(1.0, parseFloat(searchParams.get('watermark_opacity') || '0.7')));

    // Generate deterministic ETag for caching
    const focalKey = isFocalCrop ? `focal-${focalX}-${focalY}` : 'nofocal';
    const etagBasis = `${asset.id}-${asset.updated_at}-${width || 'orig'}-${height || 'orig'}-${formatParam}-${quality}-${fitParam}-${focalKey}-${hasWatermark ? `${watermarkText}-${watermarkPos}-${watermarkOpacity}` : 'none'}`;
    const etag = `W/"${crypto.createHash('md5').update(etagBasis).digest('hex')}"`;

    // 4. Handle Conditional HTTP Request (If-None-Match -> 304 Not Modified)
    const ifNoneMatch = req.headers.get('if-none-match');
    if (ifNoneMatch && (ifNoneMatch === etag || ifNoneMatch === '*')) {
      analyticsService.recordMetric({
        workspaceId: asset.workspace_id,
        assetId: asset.id,
        eventType: 'cache_hit',
        bytesTransferred: 0,
        bytesSaved: asset.size_bytes,
        format: formatParam,
        latencyMs: Date.now() - startTime,
        userAgent: req.headers.get('user-agent'),
      }).catch(() => {});

      return new NextResponse(null, {
        status: 304,
        headers: {
          'ETag': etag,
          'Cache-Control': get304CacheControl(asset),
          'X-Media-Transform': 'hit-etag-cache',
        },
      });
    }

    const storage = getStorageProvider();
    const sourceVersion = asset.metadata_json?.active_output_version || 'v1';

    // 5. Document Thumbnail Delivery (if PDF)
    if (asset.asset_type === 'document') {
      const thumbKey = asset.metadata_json?.document?.thumbnail_key || `documents/${asset.id}/${sourceVersion}/thumbnail.webp`;
      if (widthParam || formatParam === 'webp' || searchParams.has('thumbnail')) {
        try {
          const thumbBuf = await storage.download(thumbKey);
          if (thumbBuf && thumbBuf.length > 0) {
            const policy = getDeliveryPolicy(asset, {
              filename: `${asset.display_name}-thumbnail.webp`,
              contentType: 'image/webp',
            });
            return new NextResponse(new Uint8Array(thumbBuf), {
              headers: {
                ...policy.headers,
                'ETag': etag,
                'X-Media-Transform': 'hit-document-thumbnail',
              },
            });
          }
        } catch {}
      }

      // Serve original document binary
      const docBuf = await storage.download(asset.storage_key);
      if (docBuf && docBuf.length > 0) {
        const policy = getDeliveryPolicy(asset, {
          filename: asset.original_filename,
          contentType: asset.mime_type,
          disposition: 'attachment',
        });
        return new NextResponse(new Uint8Array(docBuf), {
          headers: {
            ...policy.headers,
            'ETag': etag,
          },
        });
      }
    }

    // 6. SVG Vector Delivery
    if (asset.mime_type === 'image/svg+xml' && searchParams.get('download') === 'true') {
      const svgBuf = await storage.download(asset.storage_key);
      if (svgBuf && svgBuf.length > 0) {
        const policy = getDeliveryPolicy(asset, {
          filename: asset.original_filename,
          contentType: 'image/svg+xml',
        });
        return new NextResponse(svgBuf.toString('utf8'), {
          headers: {
            ...policy.headers,
            'ETag': etag,
            'Content-Type': 'image/svg+xml',
          },
        });
      }
    }

    // 7. Check Canonical Variant Pre-rendered Cache (NO UPSCALING)
    const canonicalMatch = findCanonicalVariantMatch(width, height, formatParam);
    if (canonicalMatch && !hasWatermark && !isFocalCrop && !isSmartCrop && quality === 80 && rawFit === 'cover') {
      const canonicalKey = `images/${asset.id}/${sourceVersion}/${canonicalMatch}.webp`;
      try {
        const variantBuf = await storage.download(canonicalKey);
        if (variantBuf && variantBuf.length > 0) {
          const policy = getDeliveryPolicy(asset, {
            filename: `${asset.display_name}-${canonicalMatch}.webp`,
            contentType: 'image/webp',
          });
          return new NextResponse(new Uint8Array(variantBuf), {
            headers: {
              ...policy.headers,
              'ETag': etag,
              'X-Media-Transform': 'hit-canonical-variant',
            },
          });
        }
      } catch {}
    }

    // 8. Check Deterministic On-Demand Transform Cache
    const transformCacheKey = getTransformCacheKey(asset.id, sourceVersion, {
      width,
      height,
      format: (['webp', 'avif', 'jpeg', 'png'].includes(formatParam) ? formatParam : 'webp') as any,
      quality,
      fit: isSmartCrop ? 'smart' : isFocalCrop ? 'focal' : fitParam,
      focalX: isFocalCrop ? focalX : undefined,
      focalY: isFocalCrop ? focalY : undefined,
      watermark_pos: watermarkPos,
      watermark_opacity: watermarkOpacity,
      watermark: (hasWatermark && watermarkText) ? watermarkText : undefined,
    });

    try {
      const cachedBuf = await storage.download(transformCacheKey);
      if (cachedBuf && cachedBuf.length > 0) {
        const policy = getDeliveryPolicy(asset, {
          filename: `${asset.display_name}.${formatParam}`,
          contentType: `image/${formatParam}`,
        });
        return new NextResponse(new Uint8Array(cachedBuf), {
          headers: {
            ...policy.headers,
            'ETag': etag,
            'X-Media-Transform': 'hit-transform-cache',
          },
        });
      }
    } catch {}

    // 9. Fetch source image for transformation
    let inputBuffer: Buffer | null = await storage.download(asset.storage_key);

    if (!inputBuffer?.length) return new NextResponse('Source unavailable', { status: 503, headers: { 'Cache-Control': 'private, no-store' } });

    // 10. Sharp Pipeline Execution
    let pipeline = sharp(inputBuffer).rotate(); // auto-orient based on EXIF

    if (isFocalCrop && width && height) {
      try {
        const meta = await sharp(inputBuffer).metadata();
        const origW = meta.width || width;
        const origH = meta.height || height;
        const targetAspect = width / height;
        const origAspect = origW / origH;
        let cropW = origW;
        let cropH = origH;
        if (origAspect > targetAspect) {
          cropW = Math.max(1, Math.round(origH * targetAspect));
        } else {
          cropH = Math.max(1, Math.round(origW / targetAspect));
        }
        const focalPixelX = focalX * origW;
        const focalPixelY = focalY * origH;
        let left = Math.round(focalPixelX - cropW / 2);
        let top = Math.round(focalPixelY - cropH / 2);
        left = Math.max(0, Math.min(origW - cropW, left));
        top = Math.max(0, Math.min(origH - cropH, top));

        pipeline = pipeline
          .extract({ left, top, width: cropW, height: cropH })
          .resize({ width, height });
      } catch {
        pipeline = pipeline.resize({ width, height, fit: 'cover' });
      }
    } else if (isSmartCrop && (width || height)) {
      pipeline = pipeline.resize({
        width,
        height,
        fit: 'cover',
        position: sharp.strategy.attention,
        withoutEnlargement: true,
      });
    } else if (width || height) {
      pipeline = pipeline.resize({
        width,
        height,
        fit: fitParam === 'smart' || fitParam === 'focal' ? 'cover' : fitParam,
        withoutEnlargement: true,
      });
    }

    // Dynamic Watermark
    if (hasWatermark && watermarkText) {
      const displayText = watermarkText === 'true' || watermarkText === '1' ? 'Media Platform' : watermarkText;
      const safeText = displayText.replace(/[<>&'"]/g, (c) => {
        switch (c) {
          case '<': return '&lt;';
          case '>': return '&gt;';
          case '&': return '&amp;';
          case '\'': return '&apos;';
          case '"': return '&quot;';
          default: return c;
        }
      });

      const targetW = width || 600;
      const watermarkWidth = Math.min(280, Math.max(90, Math.round(targetW * 0.4)));
      const watermarkHeight = Math.min(48, Math.max(20, Math.round(watermarkWidth * 0.2)));
      const fontSize = Math.max(10, Math.min(16, Math.round(watermarkHeight * 0.52)));
      const textY = Math.round(watermarkHeight * 0.68);

      const watermarkSvg = `<svg width="${watermarkWidth}" height="${watermarkHeight}" xmlns="http://www.w3.org/2000/svg">
        <text x="6" y="${textY + 1}" font-family="system-ui, -apple-system, sans-serif" font-size="${fontSize}" font-weight="800" fill="rgba(0,0,0,0.4)" letter-spacing="1">${safeText}</text>
        <text x="5" y="${textY}" font-family="system-ui, -apple-system, sans-serif" font-size="${fontSize}" font-weight="800" fill="rgba(255,255,255,${watermarkOpacity})" letter-spacing="1">${safeText}</text>
      </svg>`;

      type SharpGravity = 'southeast' | 'northeast' | 'southwest' | 'northwest' | 'centre' | 'center';
      let gravity: SharpGravity = 'southeast';
      if (watermarkPos === 'center' || watermarkPos === 'centre') gravity = 'centre';
      else if (watermarkPos === 'top-left') gravity = 'northwest';
      else if (watermarkPos === 'top-right') gravity = 'northeast';
      else if (watermarkPos === 'bottom-left') gravity = 'southwest';

      pipeline = pipeline.composite([
        {
          input: Buffer.from(watermarkSvg),
          gravity,
        },
      ]);
    }

    // Format & Quality Encoding
    let contentType = 'image/webp';
    switch (formatParam) {
      case 'avif':
        pipeline = pipeline.avif({ quality });
        contentType = 'image/avif';
        break;
      case 'jpeg':
      case 'jpg':
        pipeline = pipeline.jpeg({ quality });
        contentType = 'image/jpeg';
        break;
      case 'png':
        pipeline = pipeline.png({ quality: Math.min(quality, 100) });
        contentType = 'image/png';
        break;
      case 'webp':
      default:
        pipeline = pipeline.webp({ quality });
        contentType = 'image/webp';
        break;
    }

    const outputBuffer = await pipeline.toBuffer();
    const durationMs = Date.now() - startTime;
    const bytesTransferred = outputBuffer.length;
    const bytesSaved = Math.max(0, asset.size_bytes - bytesTransferred);

    // Save to transform cache asynchronously
    storage.upload(outputBuffer, transformCacheKey, contentType).catch(() => {});

    // Record delivery metric
    analyticsService.recordMetric({
      workspaceId: asset.workspace_id,
      assetId: asset.id,
      eventType: 'delivery',
      bytesTransferred,
      bytesSaved,
      format: formatParam,
      latencyMs: durationMs,
      userAgent: req.headers.get('user-agent'),
    }).catch(() => {});

    const deliveryPolicy = getDeliveryPolicy(asset, {
      filename: `${asset.display_name}.${formatParam}`,
      contentType,
    });

    return new NextResponse(new Uint8Array(outputBuffer), {
      headers: {
        ...deliveryPolicy.headers,
        'ETag': etag,
        'X-Media-Transform': isFocalCrop ? 'sharp-focal-crop' : isSmartCrop ? 'sharp-smart-crop' : 'sharp-node-v1',
      },
    });
  } catch (error: any) {
    return new NextResponse(`Image transformation error: ${error.message}`, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';

export const GET = withApiRoute(handleGET, 'assets:read');
