import { jobQueueService, LeaseLostError, LeaseContext } from './jobQueueService';
import { assetService } from './assetService';
import { webhookService } from './webhookService';
import { ProcessingJob, Asset } from '@/types/database';
import { AppError } from '@/lib/errors/app-error';
import { videoEngine, VideoProfileDef, CANONICAL_LADDER } from '@/lib/media/videoEngine';
import { mediaWorkerCore } from '@/lib/media/workerCore';
import { imageWorkerCore } from '@/lib/media/imageWorkerCore';
import { documentWorkerCore } from '@/lib/media/documentWorkerCore';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { getStorageProvider } from '@/lib/storage/factory';
import fs from 'fs';
import path from 'path';

export { CANONICAL_LADDER };
export type { VideoProfileDef };

export const videoWorkerService = {
  resolveLadderProfiles(sourceHeight: number = 720): VideoProfileDef[] {
    return videoEngine.resolveLadderProfiles(sourceHeight);
  },

  /**
   * Helper to stage the source video file locally for ffprobe/ffmpeg processing
   */
  async stageSourceVideo(asset: Asset, targetPath: string): Promise<string> {
    const storageDownloader = async (key: string): Promise<Buffer | null> => {
      if (isSupabaseAdminConfigured()) {
        const { data, error } = await supabaseAdmin.storage
          .from(process.env.SUPABASE_STORAGE_BUCKET || 'media-assets')
          .download(key);
        if (!error && data) {
          return Buffer.from(await data.arrayBuffer());
        }
      }
      return null;
    };

    return await mediaWorkerCore.stageSourceVideo(asset, targetPath, storageDownloader);
  },

  /**
   * Execute real multi-stage media processing pipeline for a claimed job
   */
  async processJob(jobId: string, workerId: string = 'worker_service'): Promise<ProcessingJob> {
    const job = await jobQueueService.getJobById(jobId);
    if (!job) throw AppError.notFound(`Job ${jobId} not found`);

    const leaseContext: LeaseContext = {
      workerId,
      runId: job.job_run_id || undefined,
    };

    const asset = await assetService.getAssetById(job.asset_id, job.workspace_id);
    if (!asset) {
      return await jobQueueService.failJob(
        job.id,
        'SOURCE_NOT_FOUND',
        `Source asset ${job.asset_id} does not exist`,
        false,
        { asset_id: job.asset_id, worker_id: workerId },
        leaseContext
      );
    }

    const outputVersion = `v${job.attempt || 1}_${(job.job_run_id || 'run').slice(-8)}`;
    const workDir = path.join(process.cwd(), 'scratch', 'transcode', `${job.id}_${Date.now()}`);
    const sourcePath = path.join(workDir, 'source.mp4');

    const abortController = new AbortController();
    let heartbeatInterval: NodeJS.Timeout | null = null;

    try {
      if (!fs.existsSync(workDir)) {
        fs.mkdirSync(workDir, { recursive: true });
      }

      // Check heartbeat & verify lease ownership
      const initialLease = await jobQueueService.renewHeartbeat(job.id, workerId, job.job_run_id || undefined);
      if (!initialLease) {
        abortController.abort();
        throw new LeaseLostError(`LEASE_LOST: Job ${job.id} lease expired or held by another worker`);
      }

      // Background heartbeat every 15s - abort ffmpeg if lease expires or lost
      heartbeatInterval = setInterval(async () => {
        try {
          const renewed = await jobQueueService.renewHeartbeat(job.id, workerId, job.job_run_id || undefined);
          if (!renewed) {
            console.warn(`[VideoWorker] Heartbeat lost lease for job ${job.id}, aborting ffmpeg process`);
            abortController.abort();
          }
        } catch (hbErr: any) {
          console.warn(`[VideoWorker] Heartbeat error for job ${job.id}:`, hbErr?.message);
          abortController.abort();
        }
      }, 15000);

      const storage = getStorageProvider();

      if (job.job_type === 'image_optimization') {
        const outputManifest = await imageWorkerCore.executePipeline({
          jobId: job.id,
          workerId,
          runId: job.job_run_id || '',
          asset,
          outputVersion,
          workDir,
          bucket: process.env.SUPABASE_STORAGE_BUCKET || 'media-assets',
          abortSignal: abortController.signal,
          storageUploader: async (data, key, mimeType) => {
            return await storage.upload(data, key, mimeType);
          },
          progressUpdater: async (stage, percent, meta) => {
            await jobQueueService.updateJobProgress(job.id, stage as any, percent, meta, leaseContext);
          },
        });

        webhookService.dispatchEvent(
          asset.workspace_id,
          'image.processed',
          {
            asset_id: asset.id,
            job_id: job.id,
            output_version: outputVersion,
            variants: outputManifest.variants,
          },
          { eventId: `evt_image_${job.id}_${outputVersion}` }
        );

        const completedJob = await jobQueueService.getJobById(job.id);
        return completedJob || (job as ProcessingJob);
      } else if (job.job_type === 'document_extract') {
        const outputManifest = await documentWorkerCore.executePipeline({
          jobId: job.id,
          workerId,
          runId: job.job_run_id || '',
          asset,
          outputVersion,
          workDir,
          abortSignal: abortController.signal,
          storageUploader: async (data, key, mimeType) => {
            return await storage.upload(data, key, mimeType);
          },
          progressUpdater: async (stage, percent, meta) => {
            await jobQueueService.updateJobProgress(job.id, stage as any, percent, meta, leaseContext);
          },
        });

        webhookService.dispatchEvent(
          asset.workspace_id,
          'document.processed',
          {
            asset_id: asset.id,
            job_id: job.id,
            output_version: outputVersion,
            page_count: outputManifest.page_count,
            thumbnail_key: outputManifest.thumbnail_key,
          },
          { eventId: `evt_doc_${job.id}_${outputVersion}` }
        );

        const completedJob = await jobQueueService.getJobById(job.id);
        return completedJob || (job as ProcessingJob);
      } else {
        // Video transcode pipeline
        // Stage source video
        await this.stageSourceVideo(asset, sourcePath);

        const outputManifest = await mediaWorkerCore.executePipeline({
          jobId: job.id,
          workerId,
          runId: job.job_run_id || '',
          asset,
          outputVersion,
          workDir,
          bucket: process.env.SUPABASE_STORAGE_BUCKET || 'media-assets',
          abortController,
          storageUploader: async (data, key, mimeType) => {
            return await storage.upload(data, key, mimeType);
          },
          heartbeatRenewer: async () => {
            const ok = await jobQueueService.renewHeartbeat(job.id, workerId, job.job_run_id || undefined);
            if (!ok) abortController.abort();
            return ok;
          },
          fencedPublisher: async (manifest) => {
            await jobQueueService.completeJob(job.id, manifest, outputVersion, leaseContext);
            return true;
          },
          progressUpdater: async (stage, percent, meta) => {
            await jobQueueService.updateJobProgress(job.id, stage as any, percent, meta, leaseContext);
          },
        });

        // Outbound webhook notification
        webhookService.dispatchEvent(
          asset.workspace_id,
          'video.processed',
          {
            asset_id: asset.id,
            job_id: job.id,
            output_version: outputVersion,
            profiles: outputManifest.target_profiles,
            master_url: `/api/v1/delivery/video/${asset.id}/master.m3u8`,
          },
          { eventId: `evt_video_${job.id}_${outputVersion}` }
        );

        const completedJob = await jobQueueService.getJobById(job.id);
        return completedJob || (job as ProcessingJob);
      }
    } catch (err: any) {
      if (err instanceof LeaseLostError || err.name === 'LeaseLostError' || (err.message && err.message.includes('LEASE_LOST'))) {
        console.warn(`[VideoWorker] ABORTING: Lease was lost or reclaimed by another worker for job ${job.id}:`, err.message);
        throw err;
      }

      console.error(`[VideoWorker] Job ${job.id} failed:`, err);

      const { taxonomy, isRetryable, message } = mediaWorkerCore.classifyError(err);

      return await jobQueueService.failJob(
        job.id,
        taxonomy,
        message || 'Video worker transcoding pipeline failure',
        isRetryable,
        {
          stack: err.stack?.slice(0, 1000),
          worker_id: workerId,
          output_version: outputVersion,
          timestamp: new Date().toISOString(),
        },
        leaseContext
      );
    } finally {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      try {
        if (fs.existsSync(workDir)) {
          fs.rmSync(workDir, { recursive: true, force: true });
        }
      } catch (cleanErr: any) {
        console.warn(`[VideoWorker] Failed to clean workdir ${workDir}:`, cleanErr.message);
      }
    }
  },

  /**
   * Process next pending job from the priority queue via atomic claim
   */
  async processNextQueuedJob(workerId: string = 'worker_main'): Promise<ProcessingJob | null> {
    const job = await jobQueueService.claimNextJob(workerId);
    if (!job) return null;
    return await this.processJob(job.id, workerId);
  },
};
