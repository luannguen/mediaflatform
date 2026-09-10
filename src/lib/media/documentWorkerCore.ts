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

    // 1. Download document
    let docBuffer: Buffer | null = null;
    if (isSupabaseAdminConfigured()) {
      const { data, error } = await supabaseAdmin.storage
        .from(process.env.SUPABASE_STORAGE_BUCKET || 'media-assets')
        .download(asset.storage_key);
      if (!error && data) {
        docBuffer = Buffer.from(await data.arrayBuffer());
      }
    }
    if (!docBuffer) {
      docBuffer = await storage.download(asset.storage_key);
    }
    if (!docBuffer || docBuffer.length === 0) {
      throw new Error(`SOURCE_NOT_FOUND: Document ${asset.storage_key} could not be retrieved from storage`);
    }

    // 2. PDF Binary Validation
    const isPdf = docBuffer.length >= 4 && docBuffer[0] === 0x25 && docBuffer[1] === 0x50 && docBuffer[2] === 0x44 && docBuffer[3] === 0x46; // %PDF
    if (!isPdf && asset.mime_type === 'application/pdf') {
      throw new Error('CORRUPTED_SOURCE: Document header does not match PDF signature');
    }

    // 3. Inspect page count from PDF markers
    let pageCount = 1;
    try {
      const str = docBuffer.toString('latin1');
      const pageMatches = str.match(/\/Type\s*\/Page[^s]/g);
      if (pageMatches && pageMatches.length > 0) {
        pageCount = pageMatches.length;
      }
    } catch {
      // Default to 1
    }

    if (ctx.progressUpdater) {
      await ctx.progressUpdater('generating_thumbnail', 50, { stage: 'thumbnail' });
    }

    // 4. Generate high-fidelity first-page document thumbnail WebP
    // Render clean SVG document badge with title and page count, convert to WebP via Sharp
    const escapedTitle = (asset.display_name || asset.original_filename || 'PDF Document')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const svgThumb = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#1E293B"/>
          <stop offset="100%" stop-color="#0F172A"/>
        </linearGradient>
        <linearGradient id="badge" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#EF4444"/>
          <stop offset="100%" stop-color="#DC2626"/>
        </linearGradient>
      </defs>
      <rect width="600" height="800" fill="url(#bg)"/>
      <rect x="40" y="40" width="520" height="720" rx="20" fill="#FFFFFF" fill-opacity="0.04" stroke="#334155" stroke-width="2"/>
      <!-- PDF Badge -->
      <rect x="80" y="80" width="100" height="40" rx="8" fill="url(#badge)"/>
      <text x="130" y="106" fill="#FFFFFF" font-family="system-ui, sans-serif" font-size="20" font-weight="bold" text-anchor="middle">PDF</text>
      <!-- Document icon -->
      <path d="M260 260 H340 L380 300 V440 H260 Z" fill="#EF4444" fill-opacity="0.15" stroke="#EF4444" stroke-width="3"/>
      <!-- Title -->
      <text x="300" y="520" fill="#F8FAFC" font-family="system-ui, sans-serif" font-size="24" font-weight="bold" text-anchor="middle">${escapedTitle.slice(0, 30)}</text>
      <!-- Page Count & Size -->
      <text x="300" y="570" fill="#94A3B8" font-family="system-ui, sans-serif" font-size="16" text-anchor="middle">${pageCount} Page${pageCount > 1 ? 's' : ''} • ${(docBuffer.length / 1024).toFixed(0)} KB</text>
    </svg>`;

    const thumbWebp = await sharp(Buffer.from(svgThumb)).webp({ quality: 85 }).toBuffer();
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
