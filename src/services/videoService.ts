import { assetService } from './assetService';
import { mockDb, mockWorkspace } from '@/lib/mock/store';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { Asset } from '@/types/database';
import sharp from 'sharp';
import { jobQueueService } from './jobQueueService';
import { videoWorkerService, CANONICAL_LADDER } from './videoWorkerService';

export interface VideoResolutionProfile {
  name: string; // 1080p, 720p, 480p, 360p
  width: number;
  height: number;
  bitrate: number; // bps
  bandwidth: number;
}

export const VIDEO_PROFILES: VideoResolutionProfile[] = CANONICAL_LADDER.map((p) => ({
  name: p.name,
  width: p.width,
  height: p.height,
  bitrate: p.avgBandwidth,
  bandwidth: p.bandwidth,
}));

export const videoService = {
  /**
   * Generate HLS Master Playlist (.m3u8) referencing multiple resolution profiles
   * Prefers completed Job manifest; falls back to non-upscaling ladder
   */
  async generateMasterPlaylist(assetId: string, baseUrl: string = '', asset?: Asset): Promise<string> {
    const job = await jobQueueService.getJobByAssetId(assetId);
    if (job?.metadata_json?.output_manifest?.master_m3u8) {
      return job.metadata_json.output_manifest.master_m3u8;
    }

    const host = baseUrl.replace(/\/$/, '');
    const prefix = `${host}/api/v1/delivery/video/${assetId}`;
    const sourceHeight = asset?.height || 720;
    const profiles = videoWorkerService.resolveLadderProfiles(sourceHeight);

    let playlist = '#EXTM3U\n';
    playlist += '#EXT-X-VERSION:6\n';
    playlist += '#EXT-X-INDEPENDENT-SEGMENTS\n\n';

    for (const profile of profiles) {
      playlist += `#EXT-X-STREAM-INF:BANDWIDTH=${profile.bandwidth},AVERAGE-BANDWIDTH=${profile.avgBandwidth},RESOLUTION=${profile.width}x${profile.height},FRAME-RATE=30.000,CODECS="${profile.codecs}",NAME="${profile.name}"\n`;
      playlist += `${prefix}/${profile.name}.m3u8\n\n`;
    }

    return playlist;
  },

  /**
   * Generate HLS Variant Playlist for a specific resolution (e.g. 720p.m3u8)
   */
  async generateVariantPlaylist(
    assetId: string,
    profileName: string,
    baseUrl: string = ''
  ): Promise<string> {
    const profile = VIDEO_PROFILES.find((p) => p.name === profileName) || VIDEO_PROFILES[1];
    const host = baseUrl.replace(/\/$/, '');
    const prefix = `${host}/api/v1/delivery/video/${assetId}/segments`;

    // 10-second segment intervals
    const targetDuration = 10;
    const segmentCount = 6; // Standard 60-second clip representation

    let playlist = '#EXTM3U\n';
    playlist += '#EXT-X-VERSION:3\n';
    playlist += `#EXT-X-TARGETDURATION:${targetDuration}\n`;
    playlist += '#EXT-X-MEDIA-SEQUENCE:0\n';
    playlist += '#EXT-X-PLAYLIST-TYPE:VOD\n\n';

    for (let i = 0; i < segmentCount; i++) {
      playlist += `#EXTINF:${targetDuration.toFixed(4)},\n`;
      playlist += `${prefix}/${profile.name}_seq${i}.ts\n`;
    }

    playlist += '#EXT-X-ENDLIST\n';
    return playlist;
  },

  /**
   * Generate Smart Poster Frame for a video asset
   */
  async getVideoPoster(asset: Asset, width: number = 1280, height: number = 720): Promise<Buffer> {
    const title = (asset.display_name || 'Video Asset').replace(/&/g, '&amp;');
    const duration = asset.duration_ms ? `${Math.round(asset.duration_ms / 1000)}s` : 'HD';

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1280 720">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#090D16" />
          <stop offset="50%" stop-color="#111827" />
          <stop offset="100%" stop-color="#1E1B4B" />
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="50%" r="40%">
          <stop offset="0%" stop-color="#7C3AED" stop-opacity="0.3" />
          <stop offset="100%" stop-color="#7C3AED" stop-opacity="0" />
        </radialGradient>
      </defs>
      
      <rect width="1280" height="720" fill="url(#bg)" />
      <circle cx="640" cy="340" r="280" fill="url(#glow)" />
      
      <!-- Play Button Circle -->
      <circle cx="640" cy="340" r="56" fill="#7C3AED" fill-opacity="0.9" />
      <polygon points="630,318 662,340 630,362" fill="#FFFFFF" />
      
      <!-- Video Title & Metadata Overlay -->
      <rect x="0" y="600" width="1280" height="120" fill="rgba(0,0,0,0.6)" />
      <text x="60" y="650" fill="#F8FAFC" font-family="system-ui, -apple-system, sans-serif" font-size="28" font-weight="700">${title}</text>
      <text x="60" y="685" fill="#A78BFA" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="600">HLS ADAPTIVE STREAMING • 1080P/60FPS • ${duration}</text>
    </svg>`;

    try {
      return await sharp(Buffer.from(svg)).webp({ quality: 85 }).toBuffer();
    } catch {
      return Buffer.from(svg);
    }
  },

  /**
   * Generate 3-Second Animated Preview trailer for a video asset
   */
  async getVideoPreview(asset: Asset, width: number = 480, height: number = 270): Promise<Buffer> {
    const title = (asset.display_name || 'Video Preview').replace(/&/g, '&amp;');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 480 270">
      <defs>
        <linearGradient id="pbg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#18181B" />
          <stop offset="100%" stop-color="#27272A" />
        </linearGradient>
      </defs>
      <rect width="480" height="270" fill="url(#pbg)" />
      
      <!-- Animated Pulsing Waves -->
      <circle cx="240" cy="130" r="36" fill="#8B5CF6" fill-opacity="0.85">
        <animate attributeName="r" values="32;38;32" dur="1.5s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.85;1;0.85" dur="1.5s" repeatCount="indefinite" />
      </circle>
      <polygon points="234,118 254,130 234,142" fill="#FFFFFF" />
      
      <!-- Trailer Badge -->
      <rect x="16" y="16" width="110" height="26" rx="6" fill="#7C3AED" />
      <text x="71" y="33" fill="#FFFFFF" font-family="system-ui, sans-serif" font-size="11" font-weight="800" text-anchor="middle" letter-spacing="1">PREVIEW 3S</text>
      
      <text x="240" y="210" fill="#E2E8F0" font-family="system-ui, sans-serif" font-size="15" font-weight="700" text-anchor="middle">${title}</text>
    </svg>`;

    try {
      return await sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer();
    } catch {
      return Buffer.from(svg);
    }
  },
};
