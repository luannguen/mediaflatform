import { NextRequest, NextResponse } from 'next/server';
import { assetService } from '@/services/assetService';
import { videoService } from '@/services/videoService';
import { jobQueueService } from '@/services/jobQueueService';
import { getStorageProvider } from '@/lib/storage/factory';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; file: string[] | string }> }
) {
  try {
    const { id: assetId, file: rawFile } = await params;
    const fileSegments = Array.isArray(rawFile) ? rawFile : [rawFile];
    const fullPath = fileSegments.join('/');
    const fileName = fileSegments[fileSegments.length - 1].toLowerCase();

    const asset = await assetService.getAssetById(assetId);
    if (!asset || asset.status === 'deleted' || asset.status === 'trashed') {
      return new NextResponse('Video asset not found', { status: 404 });
    }

    const baseUrl = new URL(req.url).origin;

    // 1. Master HLS Playlist
    if (fileName === 'master.m3u8') {
      const playlist = await videoService.generateMasterPlaylist(assetId, baseUrl, asset);
      return new NextResponse(playlist, {
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=86400, s-maxage=86400, immutable',
        },
      });
    }

    // 2. Resolution Variant Playlists (1080p.m3u8, 720p.m3u8, etc.)
    if (fileName.endsWith('.m3u8')) {
      const profileName = fileName.replace('.m3u8', '');
      const variantPlaylist = await videoService.generateVariantPlaylist(assetId, profileName, baseUrl);
      return new NextResponse(variantPlaylist, {
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=86400, s-maxage=86400, immutable',
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
          'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable',
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
          'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable',
        },
      });
    }

    // 5. Video Segment Chunks (.ts / .m4s) - Decoupled Delivery with 307 Temporary Redirect
    if (fileName.endsWith('.ts') || fileName.endsWith('.m4s')) {
      const storage = getStorageProvider();
      const job = await jobQueueService.getJobByAssetId(assetId);
      const outputVersion = job?.output_version || (job?.metadata_json as any)?.output_version;

      // Extract profile name from path or filename, e.g. "segments/720p_seq0.ts" or "720p/000.ts"
      let profile = '720p';
      let segmentFile = fileName;
      if (fileSegments.length >= 2 && fileSegments[0] !== 'segments') {
        profile = fileSegments[0];
        segmentFile = fileSegments[1];
      } else if (fileName.includes('_')) {
        profile = fileName.split('_')[0];
      }

      if (outputVersion) {
        const exactStorageKey = `videos/${asset.id}/${outputVersion}/${profile}/${segmentFile}`;
        const exactPublicUrl = storage.getPublicUrl(exactStorageKey);
        return NextResponse.redirect(exactPublicUrl, {
          status: 307,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable',
          },
        });
      }

      // Fallback if job manifest not available yet
      if (asset.storage_url) {
        return NextResponse.redirect(asset.storage_url, {
          status: 307,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable',
          },
        });
      }

      return new NextResponse('Segment unavailable', { status: 404 });
    }

    return new NextResponse('File format not supported', { status: 400 });
  } catch (error: any) {
    return new NextResponse(`Video streaming error: ${error.message}`, { status: 500 });
  }
}
