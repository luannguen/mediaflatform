import { NextRequest, NextResponse } from 'next/server';
import { assetService } from '@/services/assetService';
import { videoService } from '@/services/videoService';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; file: string }> }
) {
  try {
    const { id: assetId, file: rawFile } = await params;
    const file = rawFile.toLowerCase();

    const asset = await assetService.getAssetById(assetId);
    if (!asset || asset.status === 'deleted' || asset.status === 'trashed') {
      return new NextResponse('Video asset not found', { status: 404 });
    }

    const baseUrl = new URL(req.url).origin;

    // 1. Master HLS Playlist
    if (file === 'master.m3u8') {
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
    if (file.endsWith('.m3u8')) {
      const profileName = file.replace('.m3u8', '');
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
    if (file === 'poster.webp' || file === 'poster.jpg' || file === 'poster.png') {
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
    if (file === 'preview.webp' || file === 'trailer.webp') {
      const previewBuffer = await videoService.getVideoPreview(asset);
      return new NextResponse(new Uint8Array(previewBuffer), {
        headers: {
          'Content-Type': 'image/webp',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable',
        },
      });
    }

    // 5. Video Segment Chunks (.ts / .m4s) - Decoupled Delivery
    if (file.endsWith('.ts') || file.endsWith('.m4s')) {
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
