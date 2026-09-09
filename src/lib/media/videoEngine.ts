import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);

function resolveBinary(name: 'ffmpeg' | 'ffprobe'): string {
  if (name === 'ffmpeg' && process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  if (name === 'ffprobe' && process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;

  try {
    const pkg = name === 'ffmpeg' ? '@ffmpeg-installer/ffmpeg' : '@ffprobe-installer/ffprobe';
    // Use eval('require') to bypass webpack static parsing
    const installer = eval('require')(pkg);
    if (installer && installer.path) return installer.path;
  } catch {}

  const platform = process.platform;
  const arch = process.arch;
  const subpkg = `@${name}-installer/${platform}-${arch}`;
  const binaryName = platform === 'win32' ? `${name}.exe` : name;
  const directPath = path.join(process.cwd(), 'node_modules', subpkg, binaryName);
  if (fs.existsSync(directPath)) return directPath;

  return name;
}

export const FFMPEG_PATH = resolveBinary('ffmpeg');
export const FFPROBE_PATH = resolveBinary('ffprobe');

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

export interface VideoProbeResult {
  width: number;
  height: number;
  durationMs: number;
  durationSec: number;
  videoCodec: string;
  audioCodec: string;
  fps: number;
  bitrate: number;
  formatName: string;
}

export interface GeneratedVariant {
  profile: string;
  resolution: string;
  bandwidth: number;
  avgBandwidth: number;
  codecs: string;
  playlistFileName: string;
  playlistContent: string;
  segments: {
    fileName: string;
    filePath: string;
  }[];
}

export interface HlsTranscodeResult {
  masterPlaylistContent: string;
  variants: GeneratedVariant[];
}

export const videoEngine = {
  /**
   * Determine the non-upscaling adaptive encoding ladder
   * Rule: If source is 720p, generate [720p, 480p, 360p]. NEVER generate 1080p.
   */
  resolveLadderProfiles(sourceHeight: number = 720): VideoProfileDef[] {
    const eligible = CANONICAL_LADDER.filter((p) => p.height <= sourceHeight);
    return eligible.length > 0 ? eligible : [CANONICAL_LADDER[CANONICAL_LADDER.length - 1]];
  },

  /**
   * Probe video container and streams using real ffprobe binary
   */
  async probeVideo(filePath: string): Promise<VideoProbeResult> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`SOURCE_NOT_FOUND: Video file does not exist at ${filePath}`);
    }

    const args = [
      '-v', 'error',
      '-show_entries', 'stream=width,height,codec_name,codec_type,r_frame_rate,bit_rate,duration',
      '-show_entries', 'format=duration,bit_rate,format_name',
      '-of', 'json',
      filePath,
    ];

    let stdout: string;
    try {
      const result = await execFileAsync(FFPROBE_PATH, args);
      stdout = result.stdout;
    } catch (err: any) {
      const msg = err.message || '';
      if (msg.includes('Invalid data') || msg.includes('moov atom not found') || msg.includes('EBADF') || msg.includes('end of file')) {
        throw new Error(`CORRUPTED_SOURCE: ffprobe failed to parse video container - ${msg}`);
      }
      throw new Error(`INVALID_VIDEO: Video probe error - ${msg}`);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new Error('CORRUPTED_SOURCE: ffprobe returned invalid JSON output');
    }

    const streams = parsed.streams || [];
    const videoStream = streams.find((s: any) => s.codec_type === 'video');
    if (!videoStream) {
      throw new Error('INVALID_VIDEO: No video stream found in container');
    }

    const audioStream = streams.find((s: any) => s.codec_type === 'audio');

    // Parse FPS
    let fps = 30;
    if (videoStream.r_frame_rate) {
      const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
      if (den && den > 0) {
        fps = Math.round((num / den) * 100) / 100;
      }
    }

    // Parse Duration
    const formatDuration = parseFloat(parsed.format?.duration || '0');
    const streamDuration = parseFloat(videoStream.duration || '0');
    const durationSec = formatDuration > 0 ? formatDuration : (streamDuration > 0 ? streamDuration : 0);
    const durationMs = Math.round(durationSec * 1000);

    const width = videoStream.width || 1280;
    const height = videoStream.height || 720;
    const bitrate = parseInt(parsed.format?.bit_rate || videoStream.bit_rate || '2500000', 10);

    return {
      width,
      height,
      durationMs,
      durationSec,
      videoCodec: videoStream.codec_name || 'unknown',
      audioCodec: audioStream?.codec_name || 'none',
      fps,
      bitrate,
      formatName: parsed.format?.format_name || 'mp4',
    };
  },

  /**
   * Transcode video into HLS variant streams and segments using real ffmpeg binary
   */
  async transcodeToHls(
    sourcePath: string,
    outputDir: string,
    ladderProfiles: VideoProfileDef[],
    options?:
      | {
          hasAudio?: boolean;
          signal?: AbortSignal;
          onProgress?: (profileName: string, percent: number) => void;
        }
      | ((profileName: string, percent: number) => void)
  ): Promise<HlsTranscodeResult> {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const onProgress = typeof options === 'function' ? options : options?.onProgress;
    const hasAudio = typeof options === 'object' && options?.hasAudio !== undefined ? options.hasAudio : true;
    const signal = typeof options === 'object' ? options?.signal : undefined;

    const variants: GeneratedVariant[] = [];

    for (let i = 0; i < ladderProfiles.length; i++) {
      if (signal?.aborted) {
        throw new Error('ABORTED: Transcoding aborted by signal');
      }

      const profile = ladderProfiles[i];
      const profileDir = path.join(outputDir, profile.name);
      if (!fs.existsSync(profileDir)) {
        fs.mkdirSync(profileDir, { recursive: true });
      }

      const segmentPattern = path.join(profileDir, '%03d.ts');
      const playlistPath = path.join(profileDir, 'index.m3u8');

      // Canonical aspect ratio preservation with black letterbox/pillarbox padding, square pixels (SAR 1:1), and fixed 30fps
      const vf = `scale=w=${profile.width}:h=${profile.height}:force_original_aspect_ratio=decrease,pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`;
      const h264Profile = profile.height >= 1080 ? 'high' : 'main';
      const h264Level = profile.height >= 1080 ? '4.1' : '3.1';

      const audioArgs = hasAudio
        ? ['-c:a', 'aac', '-ar', '48000', '-b:a', '128k']
        : ['-an'];

      const effectiveCodecs = hasAudio
        ? profile.codecs
        : profile.codecs.split(',')[0]; // avc1 only if no audio stream

      // Execute real ffmpeg encoding and segmentation with fixed 30fps matching Master manifest
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
        '-maxrate', `${profile.bandwidth}`,
        '-bufsize', `${profile.bandwidth * 2}`,
        ...audioArgs,
        '-f', 'hls',
        '-hls_time', '4',
        '-hls_playlist_type', 'vod',
        '-hls_segment_filename', segmentPattern,
        playlistPath,
      ];

      try {
        await execFileAsync(FFMPEG_PATH, ffmpegArgs, { signal });
      } catch (err: any) {
        if (signal?.aborted || err.name === 'AbortError') {
          throw new Error('LEASE_LOST: Transcoding aborted because worker lease was lost');
        }
        throw new Error(`TRANSCODING_FAILED: ffmpeg execution failed for profile ${profile.name} - ${err.message}`);
      }

      // Read generated playlist
      if (!fs.existsSync(playlistPath)) {
        throw new Error(`HLS_VALIDATION_FAILED: Variant playlist not created at ${playlistPath}`);
      }
      const rawPlaylistContent = fs.readFileSync(playlistPath, 'utf8');

      // Scan generated segments
      const segmentFiles = fs.readdirSync(profileDir)
        .filter((f) => f.endsWith('.ts'))
        .sort();

      variants.push({
        profile: profile.name,
        resolution: `${profile.width}x${profile.height}`,
        bandwidth: profile.bandwidth,
        avgBandwidth: profile.avgBandwidth,
        codecs: effectiveCodecs,
        playlistFileName: `${profile.name}.m3u8`,
        playlistContent: rawPlaylistContent,
        segments: segmentFiles.map((f) => ({
          fileName: f,
          filePath: path.join(profileDir, f),
        })),
      });

      if (onProgress) {
        onProgress(profile.name, Math.round(((i + 1) / ladderProfiles.length) * 100));
      }
    }

    // Build Master Playlist (Apple HLS Spec)
    let masterPlaylistContent = '#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-INDEPENDENT-SEGMENTS\n\n';
    for (const v of variants) {
      masterPlaylistContent += `#EXT-X-STREAM-INF:BANDWIDTH=${v.bandwidth},AVERAGE-BANDWIDTH=${v.avgBandwidth},RESOLUTION=${v.resolution},FRAME-RATE=30.000,CODECS="${v.codecs}",NAME="${v.profile}"\n`;
      masterPlaylistContent += `${v.profile}.m3u8\n\n`;
    }

    const masterPath = path.join(outputDir, 'master.m3u8');
    fs.writeFileSync(masterPath, masterPlaylistContent, 'utf8');

    return {
      masterPlaylistContent,
      variants,
    };
  },

  /**
   * Extract high-resolution poster frame from real video frame at 1s
   */
  async extractPosterFrame(
    sourcePath: string,
    outputPath: string,
    timestampSec: number = 1.0
  ): Promise<Buffer> {
    const tempJpg = outputPath.replace(/\.[^.]+$/, '_temp.jpg');

    const args = [
      '-y',
      '-ss', timestampSec.toFixed(2),
      '-i', sourcePath,
      '-vframes', '1',
      '-vf', 'scale=1280:-1',
      tempJpg,
    ];

    try {
      await execFileAsync(FFMPEG_PATH, args);
      const webpBuffer = await sharp(tempJpg).webp({ quality: 85 }).toBuffer();
      fs.writeFileSync(outputPath, webpBuffer);
      if (fs.existsSync(tempJpg)) fs.unlinkSync(tempJpg);
      return webpBuffer;
    } catch {
      // Fallback to 0.0s frame if 1.0s fails (e.g. ultra-short clips)
      const fallbackArgs = ['-y', '-i', sourcePath, '-vframes', '1', '-vf', 'scale=1280:-1', tempJpg];
      await execFileAsync(FFMPEG_PATH, fallbackArgs);
      const webpBuffer = await sharp(tempJpg).webp({ quality: 85 }).toBuffer();
      fs.writeFileSync(outputPath, webpBuffer);
      if (fs.existsSync(tempJpg)) fs.unlinkSync(tempJpg);
      return webpBuffer;
    }
  },

  /**
   * Generate 3-second animated hover preview trailer from real video frames
   */
  async generateAnimatedTrailer(
    sourcePath: string,
    outputPath: string,
    durationSec: number = 3.0
  ): Promise<Buffer> {
    const args = [
      '-y',
      '-ss', '00:00:00',
      '-t', durationSec.toFixed(2),
      '-i', sourcePath,
      '-vf', 'fps=10,scale=480:-1:flags=lanczos',
      '-loop', '0',
      outputPath,
    ];

    try {
      await execFileAsync(FFMPEG_PATH, args);
      return fs.readFileSync(outputPath);
    } catch (err: any) {
      throw new Error(`TRAILER_GENERATION_FAILED: ${err.message}`);
    }
  },
};
