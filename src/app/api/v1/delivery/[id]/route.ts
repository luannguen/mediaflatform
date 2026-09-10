import { NextRequest, NextResponse } from 'next/server';
import { assetService } from '@/services/assetService';
import { analyticsService } from '@/services/analyticsService';
import { authenticateRequest } from '@/lib/security/auth-guard';
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

    // Enforce Tenant-Aware Private Delivery Policy
    if (asset.visibility === 'private' || asset.visibility === 'workspace') {
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

      if (principal.workspaceId !== asset.workspace_id) {
        return NextResponse.json(
          { error: 'PERMISSION_DENIED', message: 'Forbidden: Cross-workspace access denied' },
          { status: 403 }
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

    // Dynamic watermark params
    const watermarkText = searchParams.get('watermark_text') || searchParams.get('watermark');
    const hasWatermark = Boolean(watermarkText && watermarkText !== 'false' && watermarkText !== '0');
    const watermarkPos = (searchParams.get('watermark_pos') || 'bottom-right').toLowerCase();
    const watermarkOpacity = Math.max(0.1, Math.min(1.0, parseFloat(searchParams.get('watermark_opacity') || '0.7')));

    // Generate deterministic ETag for caching
    const focalKey = isFocalCrop ? `focal-${focalX}-${focalY}` : 'nofocal';
    const etagBasis = `${asset.id}-${asset.updated_at}-${width || 'orig'}-${height || 'orig'}-${formatParam}-${quality}-${fitParam}-${focalKey}-${hasWatermark ? `${watermarkText}-${watermarkPos}-${watermarkOpacity}` : 'none'}`;
    const etag = `W/"${crypto.createHash('md5').update(etagBasis).digest('hex')}"`;

    // Handle Conditional HTTP Request (If-None-Match -> 304 Not Modified)
    const ifNoneMatch = req.headers.get('if-none-match');
    if (ifNoneMatch && (ifNoneMatch === etag || ifNoneMatch === '*')) {
      // Record cache hit metric asynchronously
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
          'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, stale-while-revalidate=86400, immutable',
          'X-Media-Transform': 'hit-etag-cache',
        },
      });
    }

    // If SVG vector, serve directly
    if (asset.mime_type === 'image/svg+xml') {
      if (asset.storage_url) {
        if (asset.storage_url.startsWith('data:image/svg+xml')) {
          const svgContent = decodeURIComponent(asset.storage_url.replace(/^data:image\/svg\+xml;utf8,/, ''));
          return new NextResponse(svgContent, {
            headers: {
              'Content-Type': 'image/svg+xml',
              'ETag': etag,
              'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, stale-while-revalidate=86400, immutable',
            },
          });
        }
        return NextResponse.redirect(asset.storage_url);
      }
    }

    // If not an image (e.g. video, document), either generate dynamic thumbnail poster or redirect
    if (asset.asset_type !== 'image') {
      if (widthParam || formatParam) {
        const iconColor = asset.asset_type === 'video' ? '#A855F7' : '#F59E0B';
        const label = asset.asset_type.toUpperCase();
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width || 600}" height="${height || 400}" viewBox="0 0 600 400" fill="#090D16"><rect width="600" height="400" fill="#0B0F19"/><rect x="20" y="20" width="560" height="360" rx="16" fill="#131A29" stroke="#1E293B" stroke-width="2"/><circle cx="300" cy="180" r="50" fill="${iconColor}" fill-opacity="0.15"/><polygon points="290,160 320,180 290,200" fill="${iconColor}"/><text x="300" y="270" fill="#94A3B8" font-family="system-ui, sans-serif" font-size="18" font-weight="bold" text-anchor="middle">${asset.display_name.replace(/&/g, '&amp;')}</text><text x="300" y="300" fill="${iconColor}" font-family="system-ui, sans-serif" font-size="13" font-weight="bold" text-anchor="middle">${label} PREVIEW</text></svg>`;
        return new NextResponse(svg, {
          headers: {
            'Content-Type': 'image/svg+xml',
            'ETag': etag,
            'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, stale-while-revalidate=86400, immutable',
          },
        });
      }

      if (asset.storage_url) {
        return NextResponse.redirect(asset.storage_url);
      }
      return new NextResponse('Asset has no delivery URL', { status: 400 });
    }

    // Fetch the source image
    if (!asset.storage_url) {
      return new NextResponse('Source image storage URL missing', { status: 404 });
    }

    let inputBuffer: Buffer;
    if (asset.storage_url.startsWith('data:')) {
      const base64Part = asset.storage_url.split(',')[1];
      inputBuffer = Buffer.from(base64Part, 'base64');
    } else {
      try {
        const sourceRes = await fetch(asset.storage_url);
        if (sourceRes.ok) {
          const arrayBuffer = await sourceRes.arrayBuffer();
          inputBuffer = Buffer.from(arrayBuffer);
        } else {
          const safeName = asset.display_name.replace(/&/g, '&amp;');
          const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width || 600}" height="${height || 400}"><rect width="100%" height="100%" fill="#0f172a"/><text x="50%" y="50%" fill="#64748b" font-family="system-ui" font-size="18" font-weight="bold" text-anchor="middle">${safeName}</text></svg>`;
          inputBuffer = Buffer.from(fallbackSvg);
        }
      } catch {
        const safeName = asset.display_name.replace(/&/g, '&amp;');
        const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width || 600}" height="${height || 400}"><rect width="100%" height="100%" fill="#0f172a"/><text x="50%" y="50%" fill="#64748b" font-family="system-ui" font-size="18" font-weight="bold" text-anchor="middle">${safeName}</text></svg>`;
        inputBuffer = Buffer.from(fallbackSvg);
      }
    }

    // Perform Sharp transformation pipeline
    let pipeline = sharp(inputBuffer);

    // 1. Resizing & Crop (Focal Point, Smart Attention, or Standard)
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

    // 2. Dynamic Watermark Composite
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
      if (watermarkPos === 'center' || watermarkPos === 'centre') {
        gravity = 'centre';
      } else if (watermarkPos === 'top-left') {
        gravity = 'northwest';
      } else if (watermarkPos === 'top-right') {
        gravity = 'northeast';
      } else if (watermarkPos === 'bottom-left') {
        gravity = 'southwest';
      }

      pipeline = pipeline.composite([
        {
          input: Buffer.from(watermarkSvg),
          gravity,
        },
      ]);
    }

    // 3. Output Format & Encoding
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

    // Record delivery metric asynchronously
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

    return new NextResponse(new Uint8Array(outputBuffer), {
      headers: {
        'Content-Type': contentType,
        'ETag': etag,
        'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, stale-while-revalidate=86400, immutable',
        'X-Media-Transform': isFocalCrop ? 'sharp-focal-crop' : isSmartCrop ? 'sharp-smart-crop' : 'sharp-node-v1',
      },
    });
  } catch (error: any) {
    return new NextResponse(`Image transformation error: ${error.message}`, { status: 500 });
  }
}
