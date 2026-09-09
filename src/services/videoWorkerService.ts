import { jobQueueService, LeaseLostError, LeaseContext } from './jobQueueService';
import { assetService } from './assetService';
import { webhookService } from './webhookService';
import { ProcessingJob, Asset } from '@/types/database';
import { AppError } from '@/lib/errors/app-error';
import { videoEngine, VideoProfileDef, CANONICAL_LADDER } from '@/lib/media/videoEngine';
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
    const parentDir = path.dirname(targetPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // 1. Check if asset storage_key points to an existing local file
    if (asset.storage_key && fs.existsSync(asset.storage_key)) {
      fs.copyFileSync(asset.storage_key, targetPath);
      return targetPath;
    }

    // 2. Download from Supabase Storage if configured
    if (isSupabaseAdminConfigured() && asset.storage_key) {
      try {
        const { data, error } = await supabaseAdmin.storage
          .from(process.env.SUPABASE_STORAGE_BUCKET || 'media-assets')
          .download(asset.storage_key);
        if (!error && data) {
          const buffer = Buffer.from(await data.arrayBuffer());
          fs.writeFileSync(targetPath, buffer);
          return targetPath;
        }
      } catch (err: any) {
        console.warn(`[VideoWorker] Failed to download from Supabase storage: ${err.message}`);
      }
    }

    // 3. If storage_url is a data URI (mock fallback)
    if (asset.storage_url && asset.storage_url.startsWith('data:')) {
      const parts = asset.storage_url.split(',');
      if (parts[1]) {
        fs.writeFileSync(targetPath, Buffer.from(parts[1], 'base64'));
        return targetPath;
      }
    }

    // 4. If storage_url is an http/https URL
    if (asset.storage_url && (asset.storage_url.startsWith('http://') || asset.storage_url.startsWith('https://'))) {
      try {
        const res = await fetch(asset.storage_url);
        if (res.ok) {
          const buffer = Buffer.from(await res.arrayBuffer());
          fs.writeFileSync(targetPath, buffer);
          return targetPath;
        }
      } catch (err: any) {
        console.warn(`[VideoWorker] Failed to fetch video from storage_url: ${err.message}`);
      }
    }

    throw new Error(`SOURCE_NOT_FOUND: Could not acquire source video data for asset ${asset.id}`);
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

    try {
      if (!fs.existsSync(workDir)) {
        fs.mkdirSync(workDir, { recursive: true });
      }

      // Check heartbeat & verify lease ownership
      const initialLease = await jobQueueService.renewHeartbeat(job.id, workerId, job.job_run_id || undefined);
      if (!initialLease) {
        throw new LeaseLostError(`LEASE_LOST: Job ${job.id} lease expired or held by another worker`);
      }

      // ----------------------------------------------------
      // STAGE 1: STAGING & PROBING (Metadata & Geometry Extraction)
      // ----------------------------------------------------
      await jobQueueService.updateJobProgress(job.id, 'probing', 15, {
        stage_message: 'Staging source file and probing container with ffprobe...',
        worker_id: workerId,
        output_version: outputVersion,
      }, leaseContext);

      // Stage file locally
      await this.stageSourceVideo(asset, sourcePath);

      // Probe container and streams with real ffprobe
      const probeResult = await videoEngine.probeVideo(sourcePath);

      // Verify lease before proceeding to heavy transcode
      const probeLease = await jobQueueService.renewHeartbeat(job.id, workerId, job.job_run_id || undefined);
      if (!probeLease) {
        throw new LeaseLostError(`LEASE_LOST: Job ${job.id} lease expired during probing`);
      }

      // ----------------------------------------------------
      // STAGE 2: TRANSCODING & NON-UPSCALING LADDER SELECTION
      // ----------------------------------------------------
      const targetLadder = videoEngine.resolveLadderProfiles(probeResult.height);
      const targetProfiles = targetLadder.map((p) => p.name);

      await jobQueueService.updateJobProgress(job.id, 'transcoding', 35, {
        stage_message: `Transcoding ${targetProfiles.join(', ')} with ffmpeg (non-upscaling from ${probeResult.height}p)...`,
        probe_data: probeResult,
        target_profiles: targetProfiles,
      }, leaseContext);

      // Execute real ffmpeg encoding and HLS packaging
      const hlsResult = await videoEngine.transcodeToHls(sourcePath, workDir, targetLadder);

      // Verify lease after heavy transcoding
      const transcodeLease = await jobQueueService.renewHeartbeat(job.id, workerId, job.job_run_id || undefined);
      if (!transcodeLease) {
        throw new LeaseLostError(`LEASE_LOST: Job ${job.id} lease expired during transcoding`);
      }

      // ----------------------------------------------------
      // STAGE 3: POSTER & ANIMATED TRAILER EXTRACTION
      // ----------------------------------------------------
      await jobQueueService.updateJobProgress(job.id, 'poster_generation', 70, {
        stage_message: 'Extracting video poster frame at 1.0s via ffmpeg...',
      }, leaseContext);

      const posterPath = path.join(workDir, 'poster.webp');
      const posterBuffer = await videoEngine.extractPosterFrame(sourcePath, posterPath, 1.0);

      await jobQueueService.updateJobProgress(job.id, 'preview_generation', 80, {
        stage_message: 'Generating 3s animated trailer loop from source video...',
      }, leaseContext);

      const trailerPath = path.join(workDir, 'trailer.webp');
      const trailerBuffer = await videoEngine.generateAnimatedTrailer(
        sourcePath,
        trailerPath,
        Math.min(3.0, probeResult.durationSec > 0 ? probeResult.durationSec : 3.0)
      );

      // ----------------------------------------------------
      // STAGE 4: UPLOADING OUTPUTS & ARTIFACTS
      // ----------------------------------------------------
      await jobQueueService.updateJobProgress(job.id, 'uploading_outputs', 90, {
        stage_message: 'Persisting HLS playlists and video segments to storage...',
      }, leaseContext);

      const storage = getStorageProvider();
      const storagePrefix = `videos/${asset.id}/${outputVersion}`;

      // 1. Upload Master Playlist
      const masterStorageKey = `${storagePrefix}/master.m3u8`;
      await storage.upload(
        Buffer.from(hlsResult.masterPlaylistContent, 'utf8'),
        masterStorageKey,
        'application/vnd.apple.mpegurl'
      );

      // 2. Upload Poster & Trailer
      const posterStorageKey = `${storagePrefix}/poster.webp`;
      await storage.upload(posterBuffer, posterStorageKey, 'image/webp');

      const trailerStorageKey = `${storagePrefix}/trailer.webp`;
      await storage.upload(trailerBuffer, trailerStorageKey, 'image/webp');

      // 3. Upload Variant Playlists and Segments
      const uploadedVariants: Array<{
        profile: string;
        resolution: string;
        bandwidth: number;
        avg_bandwidth: number;
        codecs: string;
        url: string;
        segment_count: number;
      }> = [];

      for (const variant of hlsResult.variants) {
        // Upload variant playlist
        const variantKey = `${storagePrefix}/${variant.playlistFileName}`;
        await storage.upload(
          Buffer.from(variant.playlistContent, 'utf8'),
          variantKey,
          'application/vnd.apple.mpegurl'
        );

        // Upload segments
        for (const seg of variant.segments) {
          const segKey = `${storagePrefix}/${variant.profile}/${seg.fileName}`;
          const segBuffer = fs.readFileSync(seg.filePath);
          await storage.upload(segBuffer, segKey, 'video/MP2T');
        }

        uploadedVariants.push({
          profile: variant.profile,
          resolution: variant.resolution,
          bandwidth: variant.bandwidth,
          avg_bandwidth: variant.avgBandwidth,
          codecs: variant.codecs,
          url: `/api/v1/delivery/video/${asset.id}/${variant.playlistFileName}`,
          segment_count: variant.segments.length,
        });
      }

      const outputManifest = {
        output_version: outputVersion,
        master_m3u8: hlsResult.masterPlaylistContent,
        variants: uploadedVariants,
        poster_url: `/api/v1/delivery/video/${asset.id}/poster.webp`,
        trailer_url: `/api/v1/delivery/video/${asset.id}/trailer.webp`,
        target_profiles: targetProfiles,
        non_upscaling_enforced: true,
        source_height: probeResult.height,
        source_width: probeResult.width,
        duration_ms: probeResult.durationMs,
        video_codec: probeResult.videoCodec,
        audio_codec: probeResult.audioCodec,
        fps: probeResult.fps,
        bitrate: probeResult.bitrate,
        created_at: new Date().toISOString(),
      };

      // ----------------------------------------------------
      // STAGE 5: VALIDATION
      // ----------------------------------------------------
      await jobQueueService.updateJobProgress(job.id, 'validating', 98, {
        stage_message: 'Validating HLS manifest compliance and segment availability...',
      }, leaseContext);

      if (!hlsResult.masterPlaylistContent.includes('#EXTM3U') || !hlsResult.masterPlaylistContent.includes('#EXT-X-VERSION')) {
        throw new Error('HLS_VALIDATION_FAILED: Master playlist header malformed');
      }

      // ----------------------------------------------------
      // STAGE 6: COMPLETION WITH FENCING
      // ----------------------------------------------------
      const completedJob = await jobQueueService.completeJob(
        job.id,
        outputManifest,
        outputVersion,
        leaseContext
      );

      // Trigger outbound webhook notification with deterministic Event ID for deduplication
      webhookService.dispatchEvent(
        asset.workspace_id,
        'video.processed',
        {
          asset_id: asset.id,
          job_id: job.id,
          output_version: outputVersion,
          profiles: targetProfiles,
          master_url: `/api/v1/delivery/video/${asset.id}/master.m3u8`,
        },
        { eventId: `evt_video_${job.id}_${outputVersion}` }
      );

      return completedJob;
    } catch (err: any) {
      // Split-brain protection: if lease was lost, abort processing without modifying job/asset
      if (err instanceof LeaseLostError || err.name === 'LeaseLostError' || (err.message && err.message.includes('LEASE_LOST'))) {
        console.warn(`[VideoWorker] ABORTING: Lease was lost or reclaimed by another worker for job ${job.id}:`, err.message);
        throw err;
      }

      console.error(`[VideoWorker] Job ${job.id} failed:`, err);

      // Taxonomy Classification
      let taxonomy = 'TEMPORARY_IO_ERROR';
      let retryable = true;

      const msg = err.message || '';
      if (msg.includes('HLS_VALIDATION_FAILED')) {
        taxonomy = 'HLS_VALIDATION_FAILED';
        retryable = false;
      } else if (msg.includes('CORRUPTED') || msg.includes('Invalid video') || msg.includes('bad header') || msg.includes('INVALID_VIDEO')) {
        taxonomy = 'CORRUPTED_SOURCE';
        retryable = false;
      } else if (msg.includes('unsupported codec') || msg.includes('UNSUPPORTED_CODEC')) {
        taxonomy = 'UNSUPPORTED_CODEC';
        retryable = false;
      } else if (msg.includes('SOURCE_NOT_FOUND')) {
        taxonomy = 'SOURCE_NOT_FOUND';
        retryable = false;
      } else if (msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('ECONNRESET')) {
        taxonomy = 'STORAGE_TIMEOUT';
        retryable = true;
      }

      return await jobQueueService.failJob(
        job.id,
        taxonomy,
        err.message || 'Video worker transcoding pipeline failure',
        retryable,
        {
          stack: err.stack?.slice(0, 1000),
          worker_id: workerId,
          output_version: outputVersion,
          timestamp: new Date().toISOString(),
        },
        leaseContext
      );
    } finally {
      // Clean up scratch temp directory
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
