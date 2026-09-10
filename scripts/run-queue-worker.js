/**
 * Standalone Background Queue Consumer / Worker Daemon
 * Supports both DIRECT compute mode (decoupled from Vercel/Next.js) and HTTP trigger mode
 * Run via: node scripts/run-queue-worker.js [--direct | --http] [--once]
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const { createClient } = require('@supabase/supabase-js');
let ffmpegInstaller, ffprobeInstaller;
try { ffmpegInstaller = require('@ffmpeg-installer/ffmpeg'); } catch {}
try { ffprobeInstaller = require('@ffprobe-installer/ffprobe'); } catch {}

// 1. Load environment variables
if (fs.existsSync('.env.local')) {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      let val = match[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[match[1].trim()] = val;
    }
  }
}

const workerId = `daemon_${process.pid}_${Date.now().toString(36)}`;
const isOnce = process.argv.includes('--once');
const forceHttp = process.argv.includes('--http');
const forceDirect = process.argv.includes('--direct');
const pollIntervalMs = parseInt(process.env.WORKER_POLL_INTERVAL_MS || '3000', 10);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const isDirectEligible = !!(supabaseUrl && supabaseKey && !forceHttp);
const isDirectMode = forceDirect || isDirectEligible;

let isRunning = true;
let isBusy = false;

console.log(`[QueueDaemon] Initializing standalone worker daemon: ${workerId}`);
console.log(`[QueueDaemon] Engine Mode: ${isDirectMode ? 'DIRECT (Decoupled Compute Worker)' : 'HTTP TRIGGER (API Gateway Proxy)'}`);
console.log(`[QueueDaemon] Polling Mode: ${isOnce ? 'ONE-SHOT' : 'CONTINUOUS POLLING'} (interval: ${pollIntervalMs}ms)`);

// Handle graceful shutdown
function handleShutdown(signal) {
  console.log(`\n[QueueDaemon] Received ${signal}. Initiating graceful shutdown...`);
  isRunning = false;
  if (!isBusy) {
    console.log('[QueueDaemon] Worker stopped cleanly. Goodbye.');
    process.exit(0);
  } else {
    console.log('[QueueDaemon] Waiting for active job to finish...');
    const timeout = setTimeout(() => {
      console.warn('[QueueDaemon] Force exiting after shutdown timeout.');
      process.exit(1);
    }, 20000);
    timeout.unref();
  }
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

const { mediaWorkerCore, LeaseLostError, CANONICAL_LADDER } = require('../src/lib/media/workerCore');

/**
 * Direct worker execution without HTTP overhead using unified MediaWorkerCore
 */
async function processJobDirect(supabase, job) {
  const runId = job.job_run_id || `run_${Date.now().toString(36)}`;
  const outputVersion = `v${job.attempt || 1}_${runId.slice(-8)}`;
  const workDir = path.join(process.cwd(), 'scratch', 'transcode', `${job.id}_${Date.now()}`);
  const sourcePath = path.join(workDir, 'source.mp4');
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'media-assets';

  const abortController = new AbortController();
  let heartbeatTimer = null;

  try {
    fs.mkdirSync(workDir, { recursive: true });

    // Initial lease check
    const { data: initialOk, error: initErr } = await supabase.rpc('renew_job_heartbeat', {
      p_job_id: job.id,
      p_worker_id: workerId,
      p_lease_seconds: 300,
      p_job_run_id: runId,
    });
    if (initErr || !initialOk) {
      abortController.abort();
      throw new LeaseLostError(`LEASE_LOST: Initial heartbeat failed or lease lost for job ${job.id}`);
    }

    // Start background heartbeat every 15 seconds with abort on lost lease
    heartbeatTimer = setInterval(async () => {
      try {
        const { data: renewed, error: hbErr } = await supabase.rpc('renew_job_heartbeat', {
          p_job_id: job.id,
          p_worker_id: workerId,
          p_lease_seconds: 300,
          p_job_run_id: runId,
        });
        if (hbErr || !renewed) {
          console.warn(`[QueueDaemon] Heartbeat lease lost for job ${job.id}, aborting FFmpeg...`);
          abortController.abort();
        }
      } catch (hbErr) {
        console.warn(`[QueueDaemon] Heartbeat exception for job ${job.id}:`, hbErr.message);
        abortController.abort();
      }
    }, 15000);

    // 1. Fetch Asset
    const { data: asset, error: assetErr } = await supabase
      .from('assets')
      .select('*')
      .eq('id', job.asset_id)
      .maybeSingle();

    if (assetErr || !asset) {
      throw new Error(`SOURCE_NOT_FOUND: Asset ${job.asset_id} not found in database`);
    }

    // 2. Stage Source Video via WorkerCore
    console.log(`[QueueDaemon] Staging video for asset ${asset.id}...`);
    await mediaWorkerCore.stageSourceVideo(asset, sourcePath, async (key) => {
      const { data, error } = await supabase.storage.from(bucket).download(key);
      if (!error && data) return Buffer.from(await data.arrayBuffer());
      return null;
    });

    // 3. Execute Unified Pipeline via WorkerCore
    console.log(`[QueueDaemon] Executing pipeline for job ${job.id} (version: ${outputVersion})...`);
    const outputManifest = await mediaWorkerCore.executePipeline({
      jobId: job.id,
      workerId,
      runId,
      asset,
      outputVersion,
      workDir,
      bucket,
      abortController,
      storageUploader: async (data, key, mimeType) => {
        const { error } = await supabase.storage.from(bucket).upload(key, data, {
          contentType: mimeType,
          upsert: true,
        });
        if (error) throw error;
      },
      heartbeatRenewer: async () => {
        const { data: renewed, error } = await supabase.rpc('renew_job_heartbeat', {
          p_job_id: job.id,
          p_worker_id: workerId,
          p_lease_seconds: 300,
          p_job_run_id: runId,
        });
        if (error || !renewed) {
          abortController.abort();
          return false;
        }
        return true;
      },
      fencedPublisher: async (manifest) => {
        const { data: published, error: pubErr } = await supabase.rpc('publish_transcoded_asset', {
          p_job_id: job.id,
          p_worker_id: workerId,
          p_job_run_id: runId,
          p_output_version: outputVersion,
          p_output_manifest: manifest,
        });
        if (!pubErr && typeof published === 'boolean') {
          return published;
        }
        return false;
      },
      progressUpdater: async (stage, percent, meta) => {
        const now = new Date().toISOString();
        const { data, error } = await supabase
          .from('processing_jobs')
          .update({
            current_stage: stage,
            progress: percent,
            heartbeat_at: now,
            updated_at: now,
          })
          .eq('id', job.id)
          .eq('status', 'processing')
          .eq('locked_by', workerId)
          .eq('job_run_id', runId)
          .gt('lease_expires_at', now)
          .select('id')
          .maybeSingle();

        if (error || !data) {
          console.warn(`[QueueDaemon] Progress update failed CAS fencing (lease lost/stolen) for job ${job.id}`);
          abortController.abort();
          throw new LeaseLostError(`LEASE_LOST: Fencing failed during progress update for job ${job.id}`);
        }
      },
    });

    console.log(`[QueueDaemon] 🚀 Successfully finished direct transcode for job ${job.id} (${outputVersion})!`);
    console.log(`[QueueDaemon] ✅ Successfully processed job ${job.id} (Stage: ready, Output: ${outputVersion})`);
    return true;
  } catch (err) {
    if (err instanceof LeaseLostError || err.name === 'LeaseLostError' || (err.message && err.message.includes('LEASE_LOST'))) {
      console.warn(`[QueueDaemon] Split-brain protection: Lease was lost or reclaimed for job ${job.id}. Aborting without mutating job.`);
      return false;
    }

    console.error(`[QueueDaemon] Direct transcode error for job ${job.id}:`, err.message);

    const { taxonomy, message, isRetryable } = mediaWorkerCore.classifyError(err);
    const currentAttempt = job.attempt || 1;
    const backoffSeconds = currentAttempt === 1 ? 30 : currentAttempt === 2 ? 120 : 600;

    // Fenced Failure Mutation via atomic PostgreSQL RPC
    const { data: failResult, error: failErr } = await supabase.rpc('fail_processing_job', {
      p_job_id: job.id,
      p_worker_id: workerId,
      p_job_run_id: runId,
      p_error_code: taxonomy,
      p_error_message: message,
      p_is_retryable: isRetryable,
      p_backoff_seconds: backoffSeconds,
      p_error_details: { attempt: currentAttempt, original_error: err.message },
    });

    if (failErr || (failResult && !failResult.success)) {
      console.warn(`[QueueDaemon] Split-brain protection: Fencing failed for fail_processing_job on ${job.id} (lease lost/stolen). Job not mutated.`);
      return false;
    }

    if (failResult && failResult.status === 'retrying') {
      console.log(`[QueueDaemon] Scheduled retry for job ${job.id} at ${failResult.available_at} (Attempt: ${failResult.attempt}, Error: ${taxonomy})`);
    } else {
      console.error(`[QueueDaemon] Routed job ${job.id} to Dead Letter Queue (DLQ). (Error: ${taxonomy})`);
    }

    return false;
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    try {
      if (fs.existsSync(workDir)) {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
    } catch {}
  }
}

async function startDaemon() {
  const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const workerToken = process.env.WORKER_SERVICE_TOKEN;

  let supabase = null;
  if (isDirectMode) {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log(`[QueueDaemon] Connected directly to Supabase (${supabaseUrl})`);
  }

  while (isRunning) {
    try {
      isBusy = true;

      if (isDirectMode && supabase) {
        // Direct claim via PostgreSQL RPC
        const runId = `run_${Date.now().toString(36)}`;
        const { data: jobs, error } = await supabase.rpc('claim_next_processing_job', {
          p_worker_id: workerId,
          p_lease_seconds: 300,
          p_job_run_id: runId,
        });

        if (error) {
          console.warn('[QueueDaemon] Direct RPC claim error:', error.message);
        } else if (Array.isArray(jobs) && jobs.length > 0) {
          const job = jobs[0];
          console.log(`[QueueDaemon] 🎯 Direct Worker claimed job: ${job.id} (Asset: ${job.asset_id})`);
          await processJobDirect(supabase, job);
          isBusy = false;
          if (isOnce) break;
          continue;
        } else {
          if (isOnce) {
            console.log('[QueueDaemon] One-shot execution complete: No pending jobs.');
            break;
          }
        }
      } else {
        // HTTP trigger fallback
        const processRes = await fetch(`${BASE_URL}/api/v1/jobs/process`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${workerToken}`,
            'X-Worker-Id': workerId,
          },
          body: JSON.stringify({ worker_id: workerId }),
        });

        if (processRes.ok) {
          const json = await processRes.json();
          const job = json.data?.job;
          if (job) {
            console.log(`[QueueDaemon] ✅ Successfully processed job ${job.id} (Stage: ${job.current_stage})`);
            isBusy = false;
            if (isOnce) break;
            continue;
          } else if (isOnce) {
            console.log('[QueueDaemon] One-shot execution complete: No pending jobs.');
            break;
          }
        } else {
          console.warn(`[QueueDaemon] Process endpoint returned HTTP ${processRes.status}`);
        }
      }
    } catch (err) {
      console.error('[QueueDaemon] Error in polling loop:', err.message);
    } finally {
      isBusy = false;
    }

    if (!isRunning || isOnce) break;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  console.log('[QueueDaemon] Worker daemon cycle finished.');
}

startDaemon().catch((err) => {
  console.error('[QueueDaemon] Fatal worker error:', err);
  process.exit(1);
});
