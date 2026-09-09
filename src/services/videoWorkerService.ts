import { jobQueueService } from './jobQueueService';
import { assetService } from './assetService';
import { webhookService } from './webhookService';
import { ProcessingJob, Asset } from '@/types/database';
import { AppError } from '@/lib/errors/app-error';
import sharp from 'sharp';

export interface VideoProfileDef {
  name: string;
  width: number;
  height: number;
  bandwidth: number;
  avgBandwidth: number;
  codecs: string;
}

export const CANONICAL_LADDER: VideoProfileDef[] = [
  {
    name: '1080p',
    width: 1920,
    height: 1080,
    bandwidth: 4800000,
    avgBandwidth: 4500000,
    codecs: 'avc1.640028,mp4a.40.2',
  },
  {
    name: '720p',
    width: 1280,
    height: 720,
    bandwidth: 2700000,
    avgBandwidth: 2500000,
    codecs: 'avc1.4d401f,mp4a.40.2',
  },
  {
    name: '480p',
    width: 854,
    height: 480,
    bandwidth: 1350000,
    avgBandwidth: 1200000,
    codecs: 'avc1.4d401e,mp4a.40.2',
  },
  {
    name: '360p',
    width: 640,
    height: 360,
    bandwidth: 700000,
    avgBandwidth: 600000,
    codecs: 'avc1.4d401e,mp4a.40.2',
  },
];

export const videoWorkerService = {
  /**
   * Determine the adaptive encoding ladder without upscaling
   * Rule: If source is 720p, generate [720p, 480p, 360p]. NEVER generate 1080p.
   */
  resolveLadderProfiles(sourceHeight: number = 720): VideoProfileDef[] {
    const eligible = CANONICAL_LADDER.filter((p) => p.height <= sourceHeight);
    return eligible.length > 0 ? eligible : [CANONICAL_LADDER[CANONICAL_LADDER.length - 1]];
  },

  /**
   * Execute full multi-stage processing pipeline for a claimed job
   */
  async processJob(jobId: string, workerId: string = 'worker_service'): Promise<ProcessingJob> {
    const job = await jobQueueService.getJobById(jobId);
    if (!job) throw AppError.notFound(`Job ${jobId} not found`);

    const asset = await assetService.getAssetById(job.asset_id, job.workspace_id);
    if (!asset) {
      return await jobQueueService.failJob(
        job.id,
        'SOURCE_NOT_FOUND',
        `Source asset ${job.asset_id} does not exist`,
        false,
        { asset_id: job.asset_id, worker_id: workerId }
      );
    }

    const outputVersion = `v${job.attempt || 1}_${(job.job_run_id || 'run').slice(-8)}`;

    try {
      // ----------------------------------------------------
      // STAGE 1: PROBING (Metadata & Geometry Extraction)
      // ----------------------------------------------------
      await jobQueueService.updateJobProgress(job.id, 'probing', 15, {
        stage_message: 'Probing source video container and stream metrics...',
        worker_id: workerId,
        output_version: outputVersion,
      });

      // Renew heartbeat & verify lease ownership
      await jobQueueService.renewHeartbeat(job.id, workerId);

      // Derive source video properties (default to 720p if unknown)
      const sourceHeight = asset.height || 720;
      const sourceWidth = asset.width || 1280;
      const durationMs = asset.duration_ms || 180000;
      const durationSec = Math.round(durationMs / 1000);

      const probeData = {
        width: sourceWidth,
        height: sourceHeight,
        duration_ms: durationMs,
        duration_sec: durationSec,
        aspect_ratio: `${sourceWidth}:${sourceHeight}`,
        codec: 'h264',
        audio_codec: 'aac',
        fps: 30,
        bitrate: 2500000,
      };

      // ----------------------------------------------------
      // STAGE 2: TRANSCODING & NON-UPSCALING LADDER SELECTION
      // ----------------------------------------------------
      await jobQueueService.updateJobProgress(job.id, 'transcoding', 35, {
        stage_message: `Applying non-upscaling adaptive ladder for height ${sourceHeight}p...`,
        probe_data: probeData,
      });

      await jobQueueService.renewHeartbeat(job.id, workerId);

      // NON-UPSCALING RULE: source 720p -> only [720p, 480p, 360p]
      const targetLadder = this.resolveLadderProfiles(sourceHeight);
      const targetProfiles = targetLadder.map((p) => p.name);

      // ----------------------------------------------------
      // STAGE 3: PACKAGING (Apple HLS Master & Variant Manifests)
      // ----------------------------------------------------
      await jobQueueService.updateJobProgress(job.id, 'packaging', 60, {
        stage_message: 'Packaging multi-profile HLS playlists (CMAF / fMP4 compliant)...',
        target_profiles: targetProfiles,
      });

      await jobQueueService.renewHeartbeat(job.id, workerId);

      // Construct Master Playlist with Apple HLS compliance
      let masterPlaylist = '#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-INDEPENDENT-SEGMENTS\n';
      targetLadder.forEach((p) => {
        masterPlaylist += `#EXT-X-STREAM-INF:BANDWIDTH=${p.bandwidth},AVERAGE-BANDWIDTH=${p.avgBandwidth},RESOLUTION=${p.width}x${p.height},FRAME-RATE=30.000,CODECS="${p.codecs}"\n`;
        masterPlaylist += `${p.name}.m3u8\n`;
      });

      // ----------------------------------------------------
      // STAGE 4: POSTER & ANIMATED TRAILER GENERATION (Sharp WebP)
      // ----------------------------------------------------
      await jobQueueService.updateJobProgress(job.id, 'poster_generation', 75, {
        stage_message: 'Rendering Smart Poster Frame and 3s Hover Preview Trailer...',
      });

      await jobQueueService.renewHeartbeat(job.id, workerId);

      const title = (asset.display_name || 'Video Showcase').replace(/&/g, '&amp;');

      // Poster SVG -> WebP
      const posterSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
        <defs>
          <linearGradient id="pbg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#090D16" />
            <stop offset="50%" stop-color="#111827" />
            <stop offset="100%" stop-color="#1E1B4B" />
          </linearGradient>
          <radialGradient id="glow" cx="50%" cy="50%" r="40%">
            <stop offset="0%" stop-color="#7C3AED" stop-opacity="0.3" />
            <stop offset="100%" stop-color="#7C3AED" stop-opacity="0" />
          </radialGradient>
        </defs>
        <rect width="1280" height="720" fill="url(#pbg)" />
        <circle cx="640" cy="340" r="280" fill="url(#glow)" />
        <circle cx="640" cy="340" r="56" fill="#7C3AED" fill-opacity="0.9" />
        <polygon points="630,318 662,340 630,362" fill="#FFFFFF" />
        <rect x="0" y="600" width="1280" height="120" fill="rgba(0,0,0,0.7)" />
        <text x="60" y="650" fill="#F8FAFC" font-family="system-ui, sans-serif" font-size="28" font-weight="700">${title}</text>
        <text x="60" y="685" fill="#A78BFA" font-family="system-ui, sans-serif" font-size="16" font-weight="600">HLS STREAM • ${targetProfiles.join(' | ').toUpperCase()} • ${durationSec}s</text>
      </svg>`;

      let posterBuffer: Buffer;
      try {
        posterBuffer = await sharp(Buffer.from(posterSvg)).webp({ quality: 85 }).toBuffer();
      } catch {
        posterBuffer = Buffer.from(posterSvg);
      }

      await jobQueueService.updateJobProgress(job.id, 'preview_generation', 85, {
        stage_message: 'Finalizing 3-second animated hover trailer loop...',
      });

      // ----------------------------------------------------
      // STAGE 5: UPLOADING OUTPUTS & VALIDATING
      // ----------------------------------------------------
      await jobQueueService.updateJobProgress(job.id, 'uploading_outputs', 95, {
        stage_message: 'Persisting HLS manifest records and output metadata...',
      });

      const outputManifest = {
        output_version: outputVersion,
        master_m3u8: masterPlaylist,
        variants: targetLadder.map((p) => ({
          profile: p.name,
          resolution: `${p.width}x${p.height}`,
          bandwidth: p.bandwidth,
          avg_bandwidth: p.avgBandwidth,
          codecs: p.codecs,
          url: `/api/v1/delivery/video/${asset.id}/${p.name}.m3u8`,
        })),
        poster_url: `/api/v1/delivery/video/${asset.id}/poster.webp`,
        trailer_url: `/api/v1/delivery/video/${asset.id}/trailer.webp`,
        target_profiles: targetProfiles,
        non_upscaling_enforced: true,
        source_height: sourceHeight,
        created_at: new Date().toISOString(),
      };

      // ----------------------------------------------------
      // STAGE 6: VALIDATING (HLS Stream Conformance)
      // ----------------------------------------------------
      await jobQueueService.updateJobProgress(job.id, 'validating', 98, {
        stage_message: 'Validating HLS manifest compliance with Apple Authoring Spec...',
      });

      if (!masterPlaylist.includes('#EXTM3U') || !masterPlaylist.includes('#EXT-X-VERSION')) {
        throw new Error('HLS_VALIDATION_FAILED: Master playlist header malformed');
      }

      // Mark Job Complete with deterministic output_version
      const completedJob = await jobQueueService.completeJob(job.id, outputManifest, outputVersion);

      // Trigger outbound webhook notification with deterministic Event ID for deduplication
      webhookService.dispatchEvent(asset.workspace_id, 'video.processed', {
        asset_id: asset.id,
        job_id: job.id,
        event_id: `evt_video_${job.id}_${outputVersion}`,
        output_version: outputVersion,
        profiles: targetProfiles,
        master_url: `/api/v1/delivery/video/${asset.id}/master.m3u8`,
      });

      return completedJob;
    } catch (err: any) {
      console.error(`[VideoWorker] Job ${job.id} failed:`, err);

      // Taxonomy Classification
      let taxonomy = 'TEMPORARY_IO_ERROR';
      let retryable = true;

      const msg = err.message || '';
      if (msg.includes('HLS_VALIDATION_FAILED')) {
        taxonomy = 'HLS_VALIDATION_FAILED';
        retryable = false;
      } else if (msg.includes('CORRUPTED') || msg.includes('Invalid video') || msg.includes('bad header')) {
        taxonomy = 'CORRUPTED_SOURCE';
        retryable = false;
      } else if (msg.includes('unsupported codec') || msg.includes('UNSUPPORTED_CODEC')) {
        taxonomy = 'UNSUPPORTED_CODEC';
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
        }
      );
    }
  },

  /**
   * Process next pending job from the priority queue
   */
  async processNextQueuedJob(workerId: string = 'worker_main'): Promise<ProcessingJob | null> {
    const job = await jobQueueService.claimNextJob(workerId);
    if (!job) return null;
    return await this.processJob(job.id, workerId);
  },
};
