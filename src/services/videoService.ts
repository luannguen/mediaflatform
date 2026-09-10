import { assetService } from './assetService';
import { mockDb, mockWorkspace } from '@/lib/mock/store';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { Asset } from '@/types/database';
import sharp from 'sharp';
import { jobQueueService } from './jobQueueService';
import { videoWorkerService, CANONICAL_LADDER } from './videoWorkerService';
import { getStorageProvider } from '@/lib/storage/factory';
import { appendDeliveryGrant } from '@/lib/security/delivery-grant';

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
   * Resolve active output version for an asset
   */
  async getActiveOutputVersion(asset: Asset): Promise<string | null> {
    if (asset.metadata_json && (asset.metadata_json as any).active_output_version) {
      return (asset.metadata_json as any).active_output_version;
    }

    const job = await jobQueueService.getJobByAssetId(asset.id);
    if (job?.output_version) return job.output_version;
    if (job?.metadata_json && (job.metadata_json as any).output_version) {
      return (job.metadata_json as any).output_version;
    }

    return null;
  },

  /**
   * Serve HLS Master Playlist (.m3u8) directly from Storage artifacts
   * Falls back to dynamic non-upscaling ladder if processing is pending
   */
  async generateMasterPlaylist(
    assetId: string,
    baseUrl: string = '',
    asset?: Asset,
    deliveryGrant?: string
  ): Promise<string | null> {
    const currentAsset = asset || (await assetService.getAssetById(assetId));
    const storage = getStorageProvider();

    const applyGrant = (content: string) => {
      if (!deliveryGrant) return content;
      return content
        .split('\n')
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return line;
          return appendDeliveryGrant(trimmed, deliveryGrant);
        })
        .join('\n');
    };

    if (currentAsset) {
      const outputVersion = await this.getActiveOutputVersion(currentAsset);
      if (outputVersion) {
        const masterStorageKey = `videos/${currentAsset.id}/${outputVersion}/master.m3u8`;
        const buffer = await storage.download(masterStorageKey);
        if (buffer && buffer.length > 0) {
          return applyGrant(buffer.toString('utf8'));
        }
      }

      // Check if real master m3u8 content is embedded in asset metadata (from CAS publish manifest)
      const assetManifestMaster = currentAsset.metadata_json?.hls?.master_m3u8 || currentAsset.metadata_json?.master_m3u8;
      if (typeof assetManifestMaster === 'string' && assetManifestMaster.includes('#EXTM3U')) {
        return applyGrant(assetManifestMaster);
      }
    }

    const job = await jobQueueService.getJobByAssetId(assetId);
    if (job?.metadata_json?.output_manifest?.master_m3u8) {
      const keyOrContent = job.metadata_json.output_manifest.master_m3u8;
      if (typeof keyOrContent === 'string' && keyOrContent.includes('#EXTM3U')) {
        return applyGrant(keyOrContent);
      }
      if (typeof keyOrContent === 'string') {
        const buf = await storage.download(keyOrContent);
        if (buf && buf.length > 0) return applyGrant(buf.toString('utf8'));
      }
    }

    // Never synthesize a fake master playlist for pending or missing artifacts
    return null;
  },

  /**
   * Serve Real HLS Variant Playlist from Storage artifacts
   * Rewrites relative segment paths (e.g. 000.ts -> 720p/000.ts) and propagates deliveryGrant if present
   */
  async generateVariantPlaylist(
    assetId: string,
    profileName: string,
    baseUrl: string = '',
    asset?: Asset,
    deliveryGrant?: string
  ): Promise<string | null> {
    const currentAsset = asset || (await assetService.getAssetById(assetId));
    if (!currentAsset) return null;

    const storage = getStorageProvider();
    const outputVersion = await this.getActiveOutputVersion(currentAsset);

    const applySegmentGrant = (rawContent: string) => {
      return rawContent
        .split('\n')
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return line;
          const target = trimmed.endsWith('.ts') && !trimmed.includes('/') ? `${profileName}/${trimmed}` : trimmed;
          return deliveryGrant ? appendDeliveryGrant(target, deliveryGrant) : target;
        })
        .join('\n');
    };

    if (outputVersion) {
      const variantKey = `videos/${currentAsset.id}/${outputVersion}/${profileName}.m3u8`;
      const buffer = await storage.download(variantKey);
      if (buffer && buffer.length > 0) {
        return applySegmentGrant(buffer.toString('utf8'));
      }
    }

    // If job completed with manifest, check if variant exists in manifest
    const job = await jobQueueService.getJobByAssetId(assetId);
    const variants = job?.metadata_json?.output_manifest?.variants;
    if (variants && Array.isArray(variants)) {
      const variantMeta = variants.find((v: any) => v.profile === profileName);
      if (variantMeta && outputVersion) {
        // Retry download directly
        const variantKey = `videos/${currentAsset.id}/${outputVersion}/${profileName}.m3u8`;
        const retryBuf = await storage.download(variantKey);
        if (retryBuf && retryBuf.length > 0) {
          return applySegmentGrant(retryBuf.toString('utf8'));
        }
      }
    }

    // If neither storage artifact nor manifest contains the variant, do NOT synthesize a fake playlist.
    return null;
  },

  /**
   * Serve Real Smart Poster Frame extracted from FFmpeg video frame
   */
  async getVideoPoster(asset: Asset, width: number = 1280, height: number = 720): Promise<Buffer> {
    const storage = getStorageProvider();
    const outputVersion = await this.getActiveOutputVersion(asset);

    if (outputVersion) {
      const posterKey = `videos/${asset.id}/${outputVersion}/poster.webp`;
      const realBuffer = await storage.download(posterKey);
      if (realBuffer && realBuffer.length > 0) {
        return realBuffer;
      }
    }

    // Fallback placeholder only if transcode is not yet complete
    return this.renderPlaceholderPoster(asset, width, height);
  },

  /**
   * Serve Real 3-Second Animated Preview Trailer extracted from FFmpeg
   */
  async getVideoPreview(asset: Asset, width: number = 480, height: number = 270): Promise<Buffer> {
    const storage = getStorageProvider();
    const outputVersion = await this.getActiveOutputVersion(asset);

    if (outputVersion) {
      const trailerKey = `videos/${asset.id}/${outputVersion}/trailer.webp`;
      const realBuffer = await storage.download(trailerKey);
      if (realBuffer && realBuffer.length > 0) {
        return realBuffer;
      }
    }

    // Fallback placeholder only if transcode is not yet complete
    return this.renderPlaceholderTrailer(asset, width, height);
  },

  /**
   * Legacy placeholder poster (used only while transcode job is in queue)
   */
  async renderPlaceholderPoster(asset: Asset, width: number = 1280, height: number = 720): Promise<Buffer> {
    const title = (asset.display_name || 'Video Processing').replace(/&/g, '&amp;');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1280 720">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#090D16" />
          <stop offset="100%" stop-color="#1E1B4B" />
        </linearGradient>
      </defs>
      <rect width="1280" height="720" fill="url(#bg)" />
      <circle cx="640" cy="340" r="56" fill="#7C3AED" fill-opacity="0.9" />
      <polygon points="630,318 662,340 630,362" fill="#FFFFFF" />
      <text x="640" y="440" fill="#F8FAFC" font-family="sans-serif" font-size="24" font-weight="700" text-anchor="middle">${title}</text>
      <text x="640" y="475" fill="#A78BFA" font-family="sans-serif" font-size="16" text-anchor="middle">Processing Video Ladder...</text>
    </svg>`;
    try {
      return await sharp(Buffer.from(svg)).webp({ quality: 85 }).toBuffer();
    } catch {
      return Buffer.from(svg);
    }
  },

  /**
   * Legacy placeholder trailer (used only while transcode job is in queue)
   */
  async renderPlaceholderTrailer(asset: Asset, width: number = 480, height: number = 270): Promise<Buffer> {
    const title = (asset.display_name || 'Processing Preview').replace(/&/g, '&amp;');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 480 270">
      <rect width="480" height="270" fill="#18181B" />
      <circle cx="240" cy="130" r="32" fill="#8B5CF6" />
      <polygon points="234,118 254,130 234,142" fill="#FFFFFF" />
      <text x="240" y="190" fill="#E2E8F0" font-family="sans-serif" font-size="14" font-weight="600" text-anchor="middle">${title}</text>
    </svg>`;
    try {
      return await sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer();
    } catch {
      return Buffer.from(svg);
    }
  },
};
