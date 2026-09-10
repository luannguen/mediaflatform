import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { Asset, AssetVariant } from '@/types/database';
import { getStorageProvider } from '@/lib/storage/factory';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { CANONICAL_IMAGE_PROFILES } from './transformPolicy';

export interface ImageWorkerContext {
  jobId: string;
  workerId: string;
  runId: string;
  asset: Asset;
  outputVersion: string;
  workDir?: string;
  bucket?: string;
  abortSignal?: AbortSignal;
  storageUploader?: (data: Buffer, key: string, mime: string) => Promise<any>;
  fencedPublisher?: (manifest: Record<string, any>, variants: any[]) => Promise<boolean>;
  progressUpdater?: (stage: string, percent: number, meta?: any) => Promise<void>;
}

export const imageWorkerCore = {
  /**
   * Execute full image optimization, sanitization, canonical variants generation & atomic publish
   */
  async executePipeline(ctx: ImageWorkerContext) {
    const { asset, outputVersion, workerId, runId, jobId } = ctx;
    const storage = getStorageProvider();

    if (ctx.progressUpdater) {
      await ctx.progressUpdater('probing', 20, { stage: 'probing_image' });
    }

    // 1. Download source image
    let sourceBuffer: Buffer | null = null;
    if (isSupabaseAdminConfigured()) {
      const { data, error } = await supabaseAdmin.storage
        .from(process.env.SUPABASE_STORAGE_BUCKET || 'media-assets')
        .download(asset.storage_key);
      if (!error && data) {
        sourceBuffer = Buffer.from(await data.arrayBuffer());
      }
    }
    if (!sourceBuffer) {
      sourceBuffer = await storage.download(asset.storage_key);
    }
    if (!sourceBuffer || sourceBuffer.length === 0) {
      throw new Error(`SOURCE_NOT_FOUND: Source image ${asset.storage_key} could not be retrieved from storage`);
    }

    if (ctx.abortSignal?.aborted) {
      throw new Error('LEASE_LOST: Job aborted before image processing');
    }

    // 2. Probe metadata & auto-orient
    let sharpPipeline = sharp(sourceBuffer).rotate(); // auto-orient based on EXIF
    const metadata = await sharpPipeline.metadata();

    const origWidth = metadata.width || asset.width || 800;
    const origHeight = metadata.height || asset.height || 600;

    // 3. Extract Dominant Color & 5-color palette
    let palette: { dominant: string; colors: string[]; is_dark: boolean } = {
      dominant: '#3b82f6',
      colors: ['#3b82f6', '#60a5fa', '#1d4ed8', '#93c5fd', '#1e3a8a'],
      is_dark: false,
    };

    try {
      const stats = await sharp(sourceBuffer).stats();
      const r = Math.round(stats.channels[0].mean);
      const g = Math.round(stats.channels[1].mean);
      const b = Math.round(stats.channels[2].mean);
      const toHex = (cr: number, cg: number, cb: number) =>
        `#${((1 << 24) + (Math.max(0, Math.min(255, cr)) << 16) + (Math.max(0, Math.min(255, cg)) << 8) + Math.max(0, Math.min(255, cb))).toString(16).slice(1)}`;

      const dominantHex = toHex(r, g, b);
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      palette = {
        dominant: dominantHex,
        colors: [dominantHex, toHex(r + 30, g + 30, b + 30), toHex(r - 30, g - 30, b - 30), toHex(r + 60, g - 20, b + 40), toHex(r - 40, g - 40, b + 20)],
        is_dark: luminance < 0.5,
      };
    } catch {
      // Fallback
    }

    if (ctx.progressUpdater) {
      await ctx.progressUpdater('generating_variants', 50, { stage: 'variants' });
    }

    // 4. Generate Canonical Variants (NO UPSCALING)
    const generatedVariants: {
      variant_name: string;
      storage_key: string;
      width: number;
      height: number;
      size_bytes: number;
      mime_type: string;
      format: string;
      quality: number;
    }[] = [];

    // Filter ladder: only generate variants whose width <= original width
    const eligibleProfiles = CANONICAL_IMAGE_PROFILES.filter((p) => p.width <= origWidth);
    // If image is smaller than thumb (160), at least generate the thumb at natural size
    if (eligibleProfiles.length === 0) {
      eligibleProfiles.push({ name: 'thumb', width: Math.min(origWidth, 160) });
    }

    for (const profile of eligibleProfiles) {
      if (ctx.abortSignal?.aborted) {
        throw new Error('LEASE_LOST: Job aborted during variant generation');
      }

      // Resize preserving aspect ratio, strip GPS EXIF, WebP format
      const variantBuffer = await sharp(sourceBuffer)
        .rotate()
        .resize({ width: profile.width, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();

      const variantMeta = await sharp(variantBuffer).metadata();
      const variantKey = `images/${asset.id}/${outputVersion}/${profile.name}.webp`;

      if (ctx.storageUploader) {
        await ctx.storageUploader(variantBuffer, variantKey, 'image/webp');
      } else {
        await storage.upload(variantBuffer, variantKey, 'image/webp');
      }

      generatedVariants.push({
        variant_name: profile.name,
        storage_key: variantKey,
        width: variantMeta.width || profile.width,
        height: variantMeta.height || Math.round((profile.width / origWidth) * origHeight),
        size_bytes: variantBuffer.length,
        mime_type: 'image/webp',
        format: 'webp',
        quality: 80,
      });
    }

    // 5. Generate and upload manifest.json
    const manifest = {
      processor: 'image',
      asset_id: asset.id,
      output_version: outputVersion,
      original: {
        width: origWidth,
        height: origHeight,
        format: metadata.format,
        has_alpha: metadata.hasAlpha || false,
        size_bytes: sourceBuffer.length,
      },
      palette,
      metadata_sanitized: true,
      variants: generatedVariants,
      generated_at: new Date().toISOString(),
    };

    const manifestKey = `images/${asset.id}/${outputVersion}/manifest.json`;
    const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
    if (ctx.storageUploader) {
      await ctx.storageUploader(manifestBuf, manifestKey, 'application/json');
    } else {
      await storage.upload(manifestBuf, manifestKey, 'application/json');
    }

    if (ctx.progressUpdater) {
      await ctx.progressUpdater('publishing', 90, { stage: 'publishing' });
    }

    // 6. Atomic Fenced Publish
    const assetMetadataUpdate = {
      image: {
        original_width: origWidth,
        original_height: origHeight,
        format: metadata.format,
        has_alpha: metadata.hasAlpha || false,
        palette,
        metadata_sanitized: true,
      },
      active_output_version: outputVersion,
    };

    if (ctx.fencedPublisher) {
      await ctx.fencedPublisher(manifest, generatedVariants);
    } else if (isSupabaseAdminConfigured()) {
      const { data: pubResult, error: pubErr } = await supabaseAdmin.rpc('publish_processed_asset', {
        p_job_id: jobId,
        p_worker_id: workerId,
        p_job_run_id: runId || null,
        p_output_version: outputVersion,
        p_output_manifest: manifest,
        p_asset_metadata: assetMetadataUpdate,
        p_variants: generatedVariants,
      });

      if (pubErr) {
        throw new Error(`PUBLISH_FAILED: Atomic publish_processed_asset RPC error: ${pubErr.message}`);
      }
      if (pubResult && pubResult.success === false) {
        throw new Error(`LEASE_LOST: Fencing failed during image publish: ${pubResult.reason}`);
      }
    } else {
      const { mockDb } = require('@/lib/mock/store');
      const job = mockDb.processingJobs.find((j: any) => j.id === jobId);
      if (job) {
        job.status = 'completed';
        job.current_stage = 'ready';
        job.progress = 100;
        job.output_version = outputVersion;
        job.completed_at = new Date().toISOString();
      }
      const a = mockDb.assets.find((item: any) => item.id === asset.id);
      if (a) {
        a.processing_status = 'ready';
        a.metadata_json = { ...(a.metadata_json || {}), ...assetMetadataUpdate };
      }
      for (const v of generatedVariants) {
        mockDb.assetVariants.push({
          id: `var_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          asset_id: asset.id,
          variant_name: v.variant_name,
          output_version: outputVersion,
          storage_key: v.storage_key,
          storage_url: null,
          width: v.width,
          height: v.height,
          size_bytes: v.size_bytes,
          mime_type: v.mime_type,
          format: v.format,
          quality: v.quality,
          created_at: new Date().toISOString(),
        });
      }
    }

    return manifest;
  },
};
