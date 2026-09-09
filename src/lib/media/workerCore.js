/**
 * Unified Media Worker Core
 * Single Source of Truth for FFmpeg execution, non-upscaling ladder,
 * heartbeat fencing, and artifact storage persistence.
 * Usable by both Next.js App Router (videoWorkerService) and standalone CLI (run-queue-worker.js).
 */

const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

let sharp = null;
try { sharp = require('sharp'); } catch {}

function resolveBinary(name) {
  if (name === 'ffmpeg' && process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  if (name === 'ffprobe' && process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;

  try {
    const pkg = name === 'ffmpeg' ? '@ffmpeg-installer/ffmpeg' : '@ffprobe-installer/ffprobe';
    const installer = require(pkg);
    if (installer && installer.path) return installer.path;
  } catch {}

  const platform = process.platform;
  const arch = process.arch;
  const subpkg = '@' + name + '-installer/' + platform + '-' + arch;
  const binaryName = platform === 'win32' ? (name + '.exe') : name;
  const directPath = path.join(process.cwd(), 'node_modules', subpkg, binaryName);
  if (fs.existsSync(directPath)) return directPath;

  return name;
}

const FFMPEG_PATH = resolveBinary('ffmpeg');
const FFPROBE_PATH = resolveBinary('ffprobe');

const CANONICAL_LADDER = [
  { name: '1080p', width: 1920, height: 1080, bandwidth: 4800000, avgBandwidth: 4500000, codecs: 'avc1.640028,mp4a.40.2' },
  { name: '720p', width: 1280, height: 720, bandwidth: 2700000, avgBandwidth: 2500000, codecs: 'avc1.4d401f,mp4a.40.2' },
  { name: '480p', width: 854, height: 480, bandwidth: 1350000, avgBandwidth: 1200000, codecs: 'avc1.4d401e,mp4a.40.2' },
  { name: '360p', width: 640, height: 360, bandwidth: 700000, avgBandwidth: 600000, codecs: 'avc1.4d401e,mp4a.40.2' },
];

const BACKOFF_SCHEDULE_MS = [
  30 * 1000,   // Attempt 1: +30s
  120 * 1000,  // Attempt 2: +2m
  600 * 1000,  // Attempt 3: +10m
];

const RETRYABLE_ERRORS = new Set([
  'STORAGE_TIMEOUT',
  'NETWORK_ERROR',
  'WORKER_INTERRUPTED',
  'TEMPORARY_IO_ERROR',
  'RATE_LIMITED',
]);

const PERMANENT_ERRORS = new Set([
  'INVALID_VIDEO',
  'CORRUPTED_SOURCE',
  'UNSUPPORTED_CODEC',
  'INVALID_CONTAINER',
  'SOURCE_NOT_FOUND',
  'HLS_VALIDATION_FAILED',
]);

class LeaseLostError extends Error {
  constructor(message = 'LEASE_LOST: Job lease expired or reclaimed by another worker') {
    super(message);
    this.name = 'LeaseLostError';
  }
}

function classifyError(err) {
  const rawMsg = err?.message || String(err);
  let taxonomy = 'TEMPORARY_IO_ERROR';

  if (rawMsg.includes('CORRUPTED_SOURCE') || rawMsg.includes('moov atom not found') || rawMsg.includes('Invalid data found')) {
    taxonomy = 'CORRUPTED_SOURCE';
  } else if (rawMsg.includes('SOURCE_NOT_FOUND')) {
    taxonomy = 'SOURCE_NOT_FOUND';
  } else if (rawMsg.includes('INVALID_VIDEO') || rawMsg.includes('No video stream')) {
    taxonomy = 'INVALID_VIDEO';
  } else if (rawMsg.includes('UNSUPPORTED_CODEC')) {
    taxonomy = 'UNSUPPORTED_CODEC';
  } else if (rawMsg.includes('HLS_VALIDATION_FAILED')) {
    taxonomy = 'HLS_VALIDATION_FAILED';
  } else if (rawMsg.includes('STORAGE_TIMEOUT') || rawMsg.includes('fetch failed') || rawMsg.includes('ETIMEDOUT') || rawMsg.includes('ECONNRESET')) {
    taxonomy = 'STORAGE_TIMEOUT';
  } else if (rawMsg.includes('RATE_LIMITED')) {
    taxonomy = 'RATE_LIMITED';
  }

  const isRetryable = RETRYABLE_ERRORS.has(taxonomy) && !PERMANENT_ERRORS.has(taxonomy);
  return { taxonomy, message: rawMsg, isRetryable };
}

function calculateNextAvailableAt(attempt) {
  const idx = Math.min(Math.max(attempt - 1, 0), BACKOFF_SCHEDULE_MS.length - 1);
  const delayMs = BACKOFF_SCHEDULE_MS[idx];
  return new Date(Date.now() + delayMs).toISOString();
}

function resolveLadderProfiles(sourceHeight = 720) {
  const eligible = CANONICAL_LADDER.filter((p) => p.height <= sourceHeight);
  if (eligible.length > 0) return eligible;
  return [CANONICAL_LADDER[CANONICAL_LADDER.length - 1]];
}

async function probeVideo(sourcePath) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error('SOURCE_NOT_FOUND: Source file does not exist at ' + sourcePath);
  }

  const probeArgs = [
    '-v', 'error',
    '-show_entries', 'stream=width,height,codec_name,codec_type,r_frame_rate,duration',
    '-show_entries', 'format=duration,bit_rate,format_name',
    '-of', 'json',
    sourcePath,
  ];

  try {
    const { stdout } = await execFileAsync(FFPROBE_PATH, probeArgs);
    const parsed = JSON.parse(stdout);
    const videoStream = (parsed.streams || []).find((s) => s.codec_type === 'video');
    const audioStream = (parsed.streams || []).find((s) => s.codec_type === 'audio');

    if (!videoStream) {
      throw new Error('INVALID_VIDEO: No video stream found in media container');
    }

    let durationSec = parseFloat(parsed.format?.duration || videoStream.duration || '0');
    let fps = 30;
    if (videoStream.r_frame_rate) {
      const parts = videoStream.r_frame_rate.split('/');
      const num = Number(parts[0]);
      const den = Number(parts[1]);
      if (den && num) fps = Math.round((num / den) * 100) / 100;
    }

    return {
      width: videoStream.width || 1280,
      height: videoStream.height || 720,
      durationSec,
      durationMs: Math.round(durationSec * 1000),
      videoCodec: videoStream.codec_name || 'h264',
      audioCodec: audioStream ? (audioStream.codec_name || 'aac') : 'none',
      fps,
      bitrate: parseInt(parsed.format?.bit_rate || '2500000', 10),
      formatName: parsed.format?.format_name || 'mp4',
    };
  } catch (err) {
    if (err.message && (err.message.includes('Invalid data') || err.message.includes('moov atom not found'))) {
      throw new Error('CORRUPTED_SOURCE: ffprobe failed to parse video container - ' + err.message);
    }
    throw err;
  }
}

async function transcodeToHls(sourcePath, outputDir, targetProfiles, options = {}) {
  const hasAudio = options.hasAudio !== false;
  const signal = options.signal;

  if (signal && signal.aborted) {
    throw new LeaseLostError('LEASE_LOST: Aborted before transcoding started');
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const ladder = (targetProfiles && targetProfiles.length > 0) ? targetProfiles : resolveLadderProfiles(720);
  const variants = [];

  for (const profile of ladder) {
    if (signal && signal.aborted) {
      throw new LeaseLostError('LEASE_LOST: Aborted during variant transcoding');
    }

    const profileDir = path.join(outputDir, profile.name);
    fs.mkdirSync(profileDir, { recursive: true });

    const segmentPattern = path.join(profileDir, '%03d.ts');
    const playlistPath = path.join(profileDir, 'index.m3u8');

    const vf = 'scale=w=' + profile.width + ':h=' + profile.height + ':force_original_aspect_ratio=decrease,pad=' + profile.width + ':' + profile.height + ':(ow-iw)/2:(oh-ih)/2:black,setsar=1';
    const h264Profile = profile.height >= 1080 ? 'high' : 'main';
    const h264Level = profile.height >= 1080 ? '4.1' : '3.1';
    const audioArgs = hasAudio ? ['-c:a', 'aac', '-ar', '48000', '-b:a', '128k'] : ['-an'];
    const effectiveCodecs = hasAudio ? profile.codecs : profile.codecs.split(',')[0];

    const ffmpegArgs = [
      '-y',
      '-i', sourcePath,
      '-vf', vf,
      '-r', '30',
      '-c:v', 'libx264',
      '-profile:v', h264Profile,
      '-level:v', h264Level,
      '-preset', 'ultrafast',
      '-crf', '23',
      '-maxrate', String(profile.bandwidth),
      '-bufsize', String(profile.bandwidth * 2),
      ...audioArgs,
      '-f', 'hls',
      '-hls_time', '4',
      '-hls_playlist_type', 'vod',
      '-hls_segment_filename', segmentPattern,
      playlistPath,
    ];

    await new Promise((resolve, reject) => {
      const child = spawn(FFMPEG_PATH, ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

      let errOutput = '';
      child.stderr.on('data', (d) => { errOutput += d.toString(); });

      const onAbort = () => {
        try { child.kill('SIGKILL'); } catch {}
        reject(new LeaseLostError('LEASE_LOST: FFmpeg process aborted due to lost heartbeat lease'));
      };

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      child.on('close', (code) => {
        if (signal) signal.removeEventListener('abort', onAbort);
        if (code === 0) {
          resolve();
        } else {
          if (signal && signal.aborted) {
            reject(new LeaseLostError('LEASE_LOST: FFmpeg process killed on abort signal'));
          } else {
            reject(new Error('FFmpeg failed for profile ' + profile.name + ' (code ' + code + '): ' + errOutput.slice(-500)));
          }
        }
      });

      child.on('error', (err) => {
        if (signal) signal.removeEventListener('abort', onAbort);
        reject(err);
      });
    });

    const rawPlaylist = fs.readFileSync(playlistPath, 'utf8');
    const segmentFiles = fs.readdirSync(profileDir).filter((f) => f.endsWith('.ts')).sort();

    variants.push({
      profile: profile.name,
      resolution: profile.width + 'x' + profile.height,
      bandwidth: profile.bandwidth,
      avgBandwidth: profile.avgBandwidth,
      codecs: effectiveCodecs,
      playlistFileName: profile.name + '.m3u8',
      playlistContent: rawPlaylist,
      segments: segmentFiles.map((f) => ({
        fileName: f,
        filePath: path.join(profileDir, f),
      })),
    });
  }

  let masterPlaylist = '#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-INDEPENDENT-SEGMENTS\n\n';
  for (const v of variants) {
    masterPlaylist += '#EXT-X-STREAM-INF:BANDWIDTH=' + v.bandwidth + ',AVERAGE-BANDWIDTH=' + v.avgBandwidth + ',RESOLUTION=' + v.resolution + ',FRAME-RATE=30.000,CODECS="' + v.codecs + '",NAME="' + v.profile + '"\n';
    masterPlaylist += v.profile + '.m3u8\n\n';
  }

  const masterPath = path.join(outputDir, 'master.m3u8');
  fs.writeFileSync(masterPath, masterPlaylist, 'utf8');

  return {
    masterPlaylistPath: masterPath,
    masterPlaylistContent: masterPlaylist,
    variants,
  };
}

async function extractPosterFrame(sourcePath, targetPath, timeSec = 1.0) {
  const parentDir = path.dirname(targetPath);
  if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });

  const timeStr = String(timeSec);
  try {
    await execFileAsync(FFMPEG_PATH, [
      '-y',
      '-ss', timeStr,
      '-i', sourcePath,
      '-vframes', '1',
      '-vf', 'scale=1280:-1',
      targetPath,
    ]);
  } catch (ffmpegErr) {
    if (sharp) {
      const fallbackBuf = await sharp({
        create: { width: 1280, height: 720, channels: 3, background: { r: 24, g: 24, b: 27 } },
      }).webp().toBuffer();
      fs.writeFileSync(targetPath, fallbackBuf);
      return fallbackBuf;
    }
    throw ffmpegErr;
  }

  return fs.readFileSync(targetPath);
}

async function generateAnimatedTrailer(sourcePath, targetPath, durationSec = 3.0) {
  const parentDir = path.dirname(targetPath);
  if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });

  try {
    await execFileAsync(FFMPEG_PATH, [
      '-y',
      '-ss', '00:00:00',
      '-t', String(durationSec),
      '-i', sourcePath,
      '-vf', 'fps=10,scale=480:-1:flags=lanczos',
      '-loop', '0',
      targetPath,
    ]);
  } catch (ffmpegErr) {
    if (sharp) {
      const fallbackBuf = await sharp({
        create: { width: 480, height: 270, channels: 3, background: { r: 39, g: 39, b: 42 } },
      }).webp().toBuffer();
      fs.writeFileSync(targetPath, fallbackBuf);
      return fallbackBuf;
    }
    throw ffmpegErr;
  }

  return fs.readFileSync(targetPath);
}

async function stageSourceVideo(asset, targetPath, storageDownloader) {
  const parentDir = path.dirname(targetPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  if (asset.storage_key && fs.existsSync(asset.storage_key)) {
    fs.copyFileSync(asset.storage_key, targetPath);
    return targetPath;
  }

  if (storageDownloader && asset.storage_key) {
    try {
      const buf = await storageDownloader(asset.storage_key);
      if (buf && buf.length > 0) {
        fs.writeFileSync(targetPath, buf);
        return targetPath;
      }
    } catch (err) {
      console.warn('[WorkerCore] Storage download failed: ' + err.message);
    }
  }

  const localScratch = path.join(process.cwd(), 'scratch', 'storage', 'media-assets', asset.storage_key || '');
  if (fs.existsSync(localScratch)) {
    fs.copyFileSync(localScratch, targetPath);
    return targetPath;
  }

  if (asset.storage_url && asset.storage_url.startsWith('data:')) {
    const parts = asset.storage_url.split(',');
    if (parts[1]) {
      fs.writeFileSync(targetPath, Buffer.from(parts[1], 'base64'));
      return targetPath;
    }
  }

  if (asset.storage_url && (asset.storage_url.startsWith('http://') || asset.storage_url.startsWith('https://'))) {
    try {
      const res = await fetch(asset.storage_url);
      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(targetPath, buffer);
        return targetPath;
      }
    } catch {}
  }

  throw new Error('SOURCE_NOT_FOUND: Could not acquire source video data for asset ' + asset.id);
}

async function executePipeline(ctx) {
  const {
    jobId,
    asset,
    outputVersion,
    workDir,
    abortController,
    storageUploader,
    heartbeatRenewer,
    fencedPublisher,
    progressUpdater,
  } = ctx;

  const sourcePath = path.join(workDir, 'source.mp4');

  if (abortController.signal.aborted) {
    throw new LeaseLostError('LEASE_LOST: Aborted before probing');
  }

  await progressUpdater('probing', 15, {
    stage_message: 'Staging source file and probing container with ffprobe...',
    output_version: outputVersion,
  });

  const probeResult = await probeVideo(sourcePath);

  const preTranscodeLease = await heartbeatRenewer();
  if (!preTranscodeLease) {
    abortController.abort();
    throw new LeaseLostError('LEASE_LOST: Job ' + jobId + ' lease expired during probing');
  }

  const targetLadder = resolveLadderProfiles(probeResult.height);
  const targetProfiles = targetLadder.map((p) => p.name);
  const hasAudio = probeResult.audioCodec !== 'none';

  await progressUpdater('transcoding', 35, {
    stage_message: 'Transcoding ' + targetProfiles.join(', ') + ' with ffmpeg (non-upscaling from ' + probeResult.height + 'p, fixed 30fps)...',
    probe_data: probeResult,
    target_profiles: targetProfiles,
  });

  const hlsResult = await transcodeToHls(sourcePath, workDir, targetLadder, {
    hasAudio,
    signal: abortController.signal,
  });

  const postTranscodeLease = await heartbeatRenewer();
  if (!postTranscodeLease) {
    abortController.abort();
    throw new LeaseLostError('LEASE_LOST: Job ' + jobId + ' lease expired after transcoding');
  }

  await progressUpdater('poster_generation', 70, {
    stage_message: 'Extracting video poster frame at 1.0s via ffmpeg...',
  });

  const posterPath = path.join(workDir, 'poster.webp');
  const posterBuffer = await extractPosterFrame(sourcePath, posterPath, 1.0);

  await progressUpdater('preview_generation', 80, {
    stage_message: 'Generating 3s animated trailer loop from source video...',
  });

  const trailerPath = path.join(workDir, 'trailer.webp');
  const trailerBuffer = await generateAnimatedTrailer(
    sourcePath,
    trailerPath,
    Math.min(3.0, probeResult.durationSec > 0 ? probeResult.durationSec : 3.0)
  );

  if (abortController.signal.aborted) {
    throw new LeaseLostError('LEASE_LOST: Aborted before upload');
  }

  await progressUpdater('uploading_outputs', 90, {
    stage_message: 'Persisting HLS playlists and video segments to storage...',
  });

  const storagePrefix = 'videos/' + asset.id + '/' + outputVersion;

  await storageUploader(
    Buffer.from(hlsResult.masterPlaylistContent, 'utf8'),
    storagePrefix + '/master.m3u8',
    'application/vnd.apple.mpegurl'
  );

  await storageUploader(posterBuffer, storagePrefix + '/poster.webp', 'image/webp');
  await storageUploader(trailerBuffer, storagePrefix + '/trailer.webp', 'image/webp');

  const uploadedVariants = [];
  for (const variant of hlsResult.variants) {
    const variantKey = storagePrefix + '/' + variant.playlistFileName;
    await storageUploader(
      Buffer.from(variant.playlistContent, 'utf8'),
      variantKey,
      'application/vnd.apple.mpegurl'
    );

    for (const seg of variant.segments) {
      const segKey = storagePrefix + '/' + variant.profile + '/' + seg.fileName;
      const segBuffer = fs.readFileSync(seg.filePath);
      await storageUploader(segBuffer, segKey, 'video/MP2T');
    }

    uploadedVariants.push({
      profile: variant.profile,
      resolution: variant.resolution,
      bandwidth: variant.bandwidth,
      avg_bandwidth: variant.avgBandwidth,
      codecs: variant.codecs,
      url: '/api/v1/delivery/video/' + asset.id + '/' + variant.playlistFileName,
      segment_count: variant.segments.length,
    });
  }

  const outputManifest = {
    output_version: outputVersion,
    master_m3u8: hlsResult.masterPlaylistContent,
    variants: uploadedVariants,
    poster_url: '/api/v1/delivery/video/' + asset.id + '/poster.webp',
    trailer_url: '/api/v1/delivery/video/' + asset.id + '/trailer.webp',
    target_profiles: targetProfiles,
    non_upscaling_enforced: true,
    source_height: probeResult.height,
    source_width: probeResult.width,
    duration_ms: probeResult.durationMs,
    video_codec: probeResult.videoCodec,
    audio_codec: probeResult.audioCodec,
    fps: 30,
    bitrate: probeResult.bitrate,
    created_at: new Date().toISOString(),
  };

  if (abortController.signal.aborted) {
    throw new LeaseLostError('LEASE_LOST: Aborted before final publish');
  }

  const publishSuccess = await fencedPublisher(outputManifest);
  if (!publishSuccess) {
    throw new LeaseLostError('LEASE_LOST: Fencing failed upon atomic publish for job ' + jobId);
  }

  return outputManifest;
}

const mediaWorkerCore = {
  CANONICAL_LADDER,
  BACKOFF_SCHEDULE_MS,
  RETRYABLE_ERRORS,
  PERMANENT_ERRORS,
  LeaseLostError,
  classifyError,
  calculateNextAvailableAt,
  resolveLadderProfiles,
  probeVideo,
  transcodeToHls,
  extractPosterFrame,
  generateAnimatedTrailer,
  stageSourceVideo,
  executePipeline,
};

module.exports = {
  mediaWorkerCore,
  CANONICAL_LADDER,
  BACKOFF_SCHEDULE_MS,
  RETRYABLE_ERRORS,
  PERMANENT_ERRORS,
  LeaseLostError,
  classifyError,
  calculateNextAvailableAt,
  resolveLadderProfiles,
  probeVideo,
  transcodeToHls,
  extractPosterFrame,
  generateAnimatedTrailer,
  stageSourceVideo,
  executePipeline,
};
