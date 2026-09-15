import { renderPdfPreview } from './pdfRenderer';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { Asset } from '@/types/database';
import { getStorageProvider } from '@/lib/storage/factory';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';

export interface DocumentWorkerContext {
  jobId: string;
  workerId: string;
  runId: string;
  asset: Asset;
  outputVersion: string;
  workDir?: string;
  sourcePath?: string;
  abortSignal?: AbortSignal;
  storageUploader?: (data: Buffer, key: string, mime: string) => Promise<any>;
  fencedPublisher?: (manifest: Record<string, any>, variants: any[]) => Promise<boolean>;
  progressUpdater?: (stage: string, percent: number, meta?: any) => Promise<void>;
}

export const documentWorkerCore = {
  /**
   * Process document (PDF): binary validation, page inspection, first-page thumbnail generation & atomic publish
   */
  async executePipeline(ctx: DocumentWorkerContext) {
    const { asset, outputVersion, workerId, runId, jobId } = ctx;
    const storage = getStorageProvider();

    if (ctx.progressUpdater) {
      await ctx.progressUpdater('probing', 20, { stage: 'probing_document' });
    }

    if (!ctx.workDir || !ctx.sourcePath) throw new Error('Verified document source is required');
    const docBuffer = await fs.readFile(ctx.sourcePath);
    const { pageCount, thumbnail: thumbWebp } = await renderPdfPreview(ctx.sourcePath, ctx.workDir, ctx.abortSignal);
    const thumbKey = `documents/${asset.id}/${outputVersion}/thumbnail.webp`;

    if (ctx.storageUploader) {
      await ctx.storageUploader(thumbWebp, thumbKey, 'image/webp');
    } else {
      await storage.upload(thumbWebp, thumbKey, 'image/webp');
    }

    // 5. Manifest
    const manifest = {
      processor: 'document',
      asset_id: asset.id,
      output_version: outputVersion,
      page_count: pageCount,
      size_bytes: docBuffer.length,
      thumbnail_key: thumbKey,
      generated_at: new Date().toISOString(),
    };

    const manifestKey = `documents/${asset.id}/${outputVersion}/manifest.json`;
    await storage.upload(Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), manifestKey, 'application/json');

    // 6. Atomic Fenced Publish
    const assetMetadataUpdate = {
      document: {
        page_count: pageCount,
        thumbnail_key: thumbKey,
      },
      active_output_version: outputVersion,
    };

    if (isSupabaseAdminConfigured()) {
      const { data: pubResult, error: pubErr } = await supabaseAdmin.rpc('publish_processed_asset', {
        p_job_id: jobId,
        p_worker_id: workerId,
        p_job_run_id: runId || null,
        p_output_version: outputVersion,
        p_output_manifest: manifest,
        p_asset_metadata: assetMetadataUpdate,
        p_variants: [],
      });

      if (pubErr) {
        throw new Error(`PUBLISH_FAILED: Document atomic publish error: ${pubErr.message}`);
      }
      if (pubResult && pubResult.success === false) {
        throw new Error(`LEASE_LOST: Fencing failed during document publish: ${pubResult.reason}`);
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
    }

    return manifest;
  },
};
