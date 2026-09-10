export interface VideoProfileDef {
  name: string;
  width: number;
  height: number;
  bandwidth: number;
  avgBandwidth: number;
  codecs: string;
}

export interface VideoProbeResult {
  width: number;
  height: number;
  durationSec: number;
  durationMs: number;
  videoCodec: string;
  audioCodec: string;
  fps: number;
  bitrate: number;
  formatName: string;
}

export interface WorkerCoreContext {
  jobId: string;
  workerId: string;
  runId: string;
  asset: any;
  outputVersion: string;
  workDir: string;
  bucket: string;
  abortController: AbortController;
  storageUploader: (data: Buffer | Uint8Array | Blob, key: string, mimeType: string) => Promise<any>;
  heartbeatRenewer: () => Promise<boolean>;
  fencedPublisher: (outputManifest: any) => Promise<boolean>;
  progressUpdater: (stage: string, percent: number, meta?: any) => Promise<any>;
}

export declare const CANONICAL_LADDER: VideoProfileDef[];
export declare const BACKOFF_SCHEDULE_MS: number[];
export declare const RETRYABLE_ERRORS: Set<string>;
export declare const PERMANENT_ERRORS: Set<string>;

export declare class LeaseLostError extends Error {
  constructor(message?: string);
}

export declare const mediaWorkerCore: {
  CANONICAL_LADDER: VideoProfileDef[];
  BACKOFF_SCHEDULE_MS: number[];
  RETRYABLE_ERRORS: Set<string>;
  PERMANENT_ERRORS: Set<string>;
  LeaseLostError: typeof LeaseLostError;
  classifyError(err: any): { taxonomy: string; message: string; isRetryable: boolean };
  calculateNextAvailableAt(attempt: number): string;
  resolveLadderProfiles(sourceHeight?: number): VideoProfileDef[];
  probeVideo(sourcePath: string): Promise<VideoProbeResult>;
  transcodeToHls(
    sourcePath: string,
    outputDir: string,
    targetProfiles: VideoProfileDef[],
    options?: { hasAudio?: boolean; signal?: AbortSignal }
  ): Promise<{
    masterPlaylistPath: string;
    masterPlaylistContent: string;
    variants: any[];
  }>;
  runAbortableProcess(
    binary: string,
    args: string[],
    signal?: AbortSignal,
    options?: { timeoutMs?: number; cwd?: string }
  ): Promise<{ stdout: string; stderr: string }>;
  extractPosterFrame(sourcePath: string, targetPath: string, timeSec?: number, signal?: AbortSignal): Promise<Buffer>;
  generateAnimatedTrailer(sourcePath: string, targetPath: string, durationSec?: number, signal?: AbortSignal): Promise<Buffer>;
  stageSourceVideo(
    asset: any,
    targetPath: string,
    storageDownloader?: (key: string) => Promise<Buffer | null>
  ): Promise<string>;
  executePipeline(ctx: WorkerCoreContext): Promise<any>;
};
