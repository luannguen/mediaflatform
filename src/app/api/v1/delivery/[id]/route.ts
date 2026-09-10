import { NextRequest, NextResponse } from 'next/server';
import { assetService } from '@/services/assetService';
import { analyticsService } from '@/services/analyticsService';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { authorize } from '@/lib/security/resourceAuthorization';
import { getStorageProvider } from '@/lib/storage/factory';
import { getDeliveryPolicy, get304CacheControl } from '@/lib/media/deliveryPolicy';
import {
  validateTransformDimensions,
  getTransformCacheKey,
  findCanonicalVariantMatch,
} from '@/lib/media/transformPolicy';
import sharp from 'sharp';
import crypto from 'crypto';

export async function GET(
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
    if (asset.visibility === 'private' || asset.visibility === 'workspace') {
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
              },
            }
          );
        }
        return NextResponse.json(
          { error: 'UNAUTHORIZED', message: 'Unauthorized: Private asset requires valid credentials' },
          {
            status: 401,
            headers: {
              'WWW-Authenticate': 'Bearer',
              'Cache-Control': 'private, no-cache, no-store, must-revalidate',
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
            },
          }
        );
      }
    }

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
    if (asset.mime_type === 'image/svg+xml') {
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
    if (canonicalMatch && !hasWatermark && rawFit === 'cover') {
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
      fit: fitParam,
      focalX: isFocalCrop ? focalX : undefined,
      focalY: isFocalCrop ? focalY : undefined,
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

    if (!inputBuffer || inputBuffer.length === 0) {
      if (asset.storage_url && asset.storage_url.startsWith('data:')) {
        const base64Part = asset.storage_url.split(',')[1];
        inputBuffer = Buffer.from(base64Part, 'base64');
      } else if (asset.storage_url) {
        try {
          const sourceRes = await fetch(asset.storage_url);
          if (sourceRes.ok) {
            inputBuffer = Buffer.from(await sourceRes.arrayBuffer());
          }
        } catch {}
      }
    }

    if (!inputBuffer || inputBuffer.length === 0) {
      const safeName = asset.display_name.replace(/&/g, '&amp;');
      const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width || 600}" height="${height || 400}"><rect width="100%" height="100%" fill="#0f172a"/><text x="50%" y="50%" fill="#64748b" font-family="system-ui" font-size="18" font-weight="bold" text-anchor="middle">${safeName}</text></svg>`;
      inputBuffer = Buffer.from(fallbackSvg);
    }

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
