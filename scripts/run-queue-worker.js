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

const FFMPEG_PATH = process.env.FFMPEG_PATH || (ffmpegInstaller && ffmpegInstaller.path) || 'ffmpeg';
const FFPROBE_PATH = process.env.FFPROBE_PATH || (ffprobeInstaller && ffprobeInstaller.path) || 'ffprobe';

const CANONICAL_LADDER = [
  { name: '1080p', width: 1920, height: 1080, bandwidth: 4800000, avgBandwidth: 4500000, codecs: 'avc1.640028,mp4a.40.2' },
  { name: '720p', width: 1280, height: 720, bandwidth: 2700000, avgBandwidth: 2500000, codecs: 'avc1.4d401f,mp4a.40.2' },
  { name: '480p', width: 854, height: 480, bandwidth: 1350000, avgBandwidth: 1200000, codecs: 'avc1.4d401e,mp4a.40.2' },
  { name: '360p', width: 640, height: 360, bandwidth: 700000, avgBandwidth: 600000, codecs: 'avc1.4d401e,mp4a.40.2' },
];

/**
 * Direct worker execution without HTTP overhead
 */
async function processJobDirect(supabase, job) {
  const runId = job.job_run_id || `run_${Date.now().toString(36)}`;
  const leaseContext = { workerId, runId };
  const outputVersion = `v${job.attempt || 1}_${runId.slice(-8)}`;
  const workDir = path.join(process.cwd(), 'scratch', 'transcode', `${job.id}_${Date.now()}`);
  const sourcePath = path.join(workDir, 'source.mp4');
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'media-assets';

  let heartbeatTimer = null;

  try {
    fs.mkdirSync(workDir, { recursive: true });

    // Start background heartbeat every 15 seconds
    heartbeatTimer = setInterval(async () => {
      try {
        await supabase.rpc('renew_job_heartbeat', {
          p_job_id: job.id,
          p_worker_id: workerId,
          p_lease_seconds: 300,
          p_job_run_id: runId,
        });
      } catch (hbErr) {
        console.warn(`[QueueDaemon] Heartbeat warning for job ${job.id}:`, hbErr.message);
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

    // 2. Stage Source Video
    console.log(`[QueueDaemon] Staging video for asset ${asset.id}...`);
    if (asset.storage_key && fs.existsSync(asset.storage_key)) {
      fs.copyFileSync(asset.storage_key, sourcePath);
    } else if (asset.storage_key) {
      const { data: fileData, error: dlErr } = await supabase.storage.from(bucket).download(asset.storage_key);
      if (dlErr || !fileData) {
        // Fallback to local storage scratch cache if available
        const localCache = path.join(process.cwd(), 'scratch', 'storage', bucket, asset.storage_key);
        if (fs.existsSync(localCache)) {
          fs.copyFileSync(localCache, sourcePath);
        } else {
          throw new Error(`SOURCE_NOT_FOUND: Could not download storage key ${asset.storage_key}: ${dlErr?.message}`);
        }
      } else {
        const buf = Buffer.from(await fileData.arrayBuffer());
        fs.writeFileSync(sourcePath, buf);
      }
    } else {
      throw new Error(`SOURCE_NOT_FOUND: No storage_key for asset ${asset.id}`);
    }

    // 3. Probe Video
    console.log(`[QueueDaemon] Probing container with ffprobe...`);
    const probeArgs = [
      '-v', 'error',
      '-show_entries', 'stream=width,height,codec_name,codec_type,r_frame_rate,duration',
      '-show_entries', 'format=duration,bit_rate,format_name',
      '-of', 'json',
      sourcePath,
    ];
    const probeRes = await execFileAsync(FFPROBE_PATH, probeArgs);
    const probeJson = JSON.parse(probeRes.stdout);
    const vStream = (probeJson.streams || []).find((s) => s.codec_type === 'video');
    const aStream = (probeJson.streams || []).find((s) => s.codec_type === 'audio');
    if (!vStream) throw new Error('INVALID_VIDEO: No video stream found in container');

    const sourceHeight = vStream.height || 720;
    const sourceWidth = vStream.width || 1280;
    const hasAudio = !!aStream;

    // 4. Resolve Non-Upscaling Ladder
    const ladder = CANONICAL_LADDER.filter((p) => p.height <= sourceHeight);
    const targetLadder = ladder.length > 0 ? ladder : [CANONICAL_LADDER[CANONICAL_LADDER.length - 1]];
    const targetProfiles = targetLadder.map((p) => p.name);

    console.log(`[QueueDaemon] Transcoding ladder: ${targetProfiles.join(', ')} (source: ${sourceWidth}x${sourceHeight})...`);
    await supabase.from('processing_jobs').update({
      current_stage: 'transcoding',
      progress: 35,
      updated_at: new Date().toISOString(),
    }).eq('id', job.id);

    // 5. Transcode HLS Profiles via FFmpeg
    const variants = [];
    for (const profile of targetLadder) {
      const profileDir = path.join(workDir, profile.name);
      fs.mkdirSync(profileDir, { recursive: true });
      const segmentPattern = path.join(profileDir, '%03d.ts');
      const playlistPath = path.join(profileDir, 'index.m3u8');

      const vf = `scale=w=${profile.width}:h=${profile.height}:force_original_aspect_ratio=decrease,pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`;
      const h264Profile = profile.height >= 1080 ? 'high' : 'main';
      const h264Level = profile.height >= 1080 ? '4.1' : '3.1';
      const audioArgs = hasAudio ? ['-c:a', 'aac', '-ar', '48000', '-b:a', '128k'] : ['-an'];
      const effectiveCodecs = hasAudio ? profile.codecs : profile.codecs.split(',')[0];

      await execFileAsync(FFMPEG_PATH, [
        '-y', '-i', sourcePath,
        '-vf', vf,
        '-c:v', 'libx264', '-profile:v', h264Profile, '-level:v', h264Level,
        '-preset', 'ultrafast', '-crf', '23',
        '-maxrate', `${profile.bandwidth}`, '-bufsize', `${profile.bandwidth * 2}`,
        ...audioArgs,
        '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod',
        '-hls_segment_filename', segmentPattern,
        playlistPath,
      ]);

      const rawPlaylist = fs.readFileSync(playlistPath, 'utf8');
      const segmentFiles = fs.readdirSync(profileDir).filter((f) => f.endsWith('.ts')).sort();

      variants.push({
        profile: profile.name,
        resolution: `${profile.width}x${profile.height}`,
        bandwidth: profile.bandwidth,
        avgBandwidth: profile.avgBandwidth,
        codecs: effectiveCodecs,
        playlistFileName: `${profile.name}.m3u8`,
        playlistContent: rawPlaylist,
        segments: segmentFiles.map((f) => ({ fileName: f, filePath: path.join(profileDir, f) })),
      });
    }

    // 6. Master Playlist
    let masterPlaylist = '#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-INDEPENDENT-SEGMENTS\n\n';
    for (const v of variants) {
      masterPlaylist += `#EXT-X-STREAM-INF:BANDWIDTH=${v.bandwidth},AVERAGE-BANDWIDTH=${v.avgBandwidth},RESOLUTION=${v.resolution},FRAME-RATE=30.000,CODECS="${v.codecs}",NAME="${v.profile}"\n`;
      masterPlaylist += `${v.profile}.m3u8\n\n`;
    }

    // 7. Poster & Trailer Generation
    console.log(`[QueueDaemon] Extracting poster and animated trailer...`);
    const posterPath = path.join(workDir, 'poster.webp');
    await execFileAsync(FFMPEG_PATH, [
      '-y', '-ss', '00:00:01', '-i', sourcePath, '-vframes', '1', '-vf', 'scale=1280:-1',
      posterPath,
    ]);

    const trailerPath = path.join(workDir, 'trailer.webp');
    await execFileAsync(FFMPEG_PATH, [
      '-y', '-ss', '00:00:00', '-t', '3.00', '-i', sourcePath,
      '-vf', 'fps=10,scale=480:-1:flags=lanczos', '-loop', '0',
      trailerPath,
    ]);

    // 8. Upload Artifacts to Supabase Storage
    console.log(`[QueueDaemon] Uploading HLS artifacts to storage (version: ${outputVersion})...`);
    const prefix = `videos/${asset.id}/${outputVersion}`;

    // Upload master playlist
    await supabase.storage.from(bucket).upload(`${prefix}/master.m3u8`, Buffer.from(masterPlaylist, 'utf8'), {
      contentType: 'application/vnd.apple.mpegurl',
      upsert: true,
    });

    // Upload poster & trailer
    if (fs.existsSync(posterPath)) {
      await supabase.storage.from(bucket).upload(`${prefix}/poster.webp`, fs.readFileSync(posterPath), {
        contentType: 'image/webp',
        upsert: true,
      });
    }
    if (fs.existsSync(trailerPath)) {
      await supabase.storage.from(bucket).upload(`${prefix}/trailer.webp`, fs.readFileSync(trailerPath), {
        contentType: 'image/webp',
        upsert: true,
      });
    }

    // Upload variant playlists & segments
    for (const variant of variants) {
      await supabase.storage.from(bucket).upload(`${prefix}/${variant.playlistFileName}`, Buffer.from(variant.playlistContent, 'utf8'), {
        contentType: 'application/vnd.apple.mpegurl',
        upsert: true,
      });

      for (const seg of variant.segments) {
        await supabase.storage.from(bucket).upload(`${prefix}/${variant.profile}/${seg.fileName}`, fs.readFileSync(seg.filePath), {
          contentType: 'video/MP2T',
          upsert: true,
        });
      }
    }

    const outputManifest = {
      output_version: outputVersion,
      master_m3u8: masterPlaylist,
      variants: variants.map((v) => ({
        profile: v.profile,
        resolution: v.resolution,
        bandwidth: v.bandwidth,
        avg_bandwidth: v.avgBandwidth,
        codecs: v.codecs,
        url: `/api/v1/delivery/video/${asset.id}/${v.playlistFileName}`,
        segment_count: v.segments.length,
      })),
      poster_url: `/api/v1/delivery/video/${asset.id}/poster.webp`,
      trailer_url: `/api/v1/delivery/video/${asset.id}/trailer.webp`,
      target_profiles: targetProfiles,
      source_height: sourceHeight,
      source_width: sourceWidth,
      created_at: new Date().toISOString(),
    };

    // 9. Complete Job & Update Asset
    const now = new Date().toISOString();
    await supabase.from('processing_jobs').update({
      status: 'completed',
      current_stage: 'ready',
      progress: 100,
      output_version: outputVersion,
      completed_at: now,
      heartbeat_at: now,
      lease_expires_at: null,
      updated_at: now,
      metadata_json: { output_manifest: outputManifest },
    }).eq('id', job.id).eq('status', 'processing').eq('locked_by', workerId);

    const mergedMetadata = {
      ...(asset.metadata_json || {}),
      hls: outputManifest,
      active_output_version: outputVersion,
    };

    await supabase.from('assets').update({
      processing_status: 'ready',
      metadata_json: mergedMetadata,
      updated_at: now,
    }).eq('id', asset.id);

    console.log(`[QueueDaemon] 🚀 Successfully finished direct transcode for job ${job.id} (${outputVersion})!`);
    console.log(`[QueueDaemon] ✅ Successfully processed job ${job.id} (Stage: ready, Output: ${outputVersion})`);
    return true;
  } catch (err) {
    console.error(`[QueueDaemon] Direct transcode error for job ${job.id}:`, err.message);
    const now = new Date().toISOString();
    await supabase.from('processing_jobs').update({
      status: 'dead_letter',
      current_stage: 'failed',
      error_message: err.message,
      updated_at: now,
    }).eq('id', job.id);
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
