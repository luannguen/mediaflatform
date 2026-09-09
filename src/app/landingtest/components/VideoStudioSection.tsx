'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Film,
  UploadCloud,
  Sparkles,
  Play,
  Pause,
  Copy,
  Check,
  Trash2,
  AlertTriangle,
  RefreshCw,
  Layers,
  Monitor,
  Sliders,
  CheckCircle2,
  Clock,
  ExternalLink,
  ShieldAlert,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import Hls from 'hls.js';
import { DEMO_CREDENTIALS } from './HeroSection';

interface VideoAsset {
  id: string;
  display_name: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
  processing_status?: string;
  created_at: string;
  metadata_json?: any;
}

interface JobProgress {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  current_stage?: string;
  progress?: number;
  attempt?: number;
  worker_id?: string;
  output_version?: string;
  error_message?: string | null;
}

interface RenditionLevel {
  index: number;
  name: string;
  height: number;
  width: number;
  bitrate: number;
}

const STAGES = [
  { id: 'queued', label: 'Hàng Đợi', desc: 'Đã enqueue vào database', pct: 10 },
  { id: 'probing', label: 'FFprobe Meta', desc: 'Đọc codec, FPS, độ phân giải gốc', pct: 25 },
  { id: 'transcoding', label: 'FFmpeg Transcode', desc: 'Sinh ladder HLS & .ts segments', pct: 55 },
  { id: 'poster_generation', label: 'Smart Poster', desc: 'Trích xuất WebP keyframe 1.0s', pct: 75 },
  { id: 'preview_generation', label: 'Animated Trailer', desc: 'Tạo 3s WebP loop animation', pct: 88 },
  { id: 'ready', label: 'Atomic CAS Publish', desc: 'Hoàn tất & phát trực tuyến', pct: 100 },
];

export function VideoStudioSection() {
  // Video lists & active player state
  const [videos, setVideos] = useState<VideoAsset[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(true);
  const [activeVideo, setActiveVideo] = useState<VideoAsset | null>(null);

  // Upload & generation states
  const [isUploading, setIsUploading] = useState(false);
  const [isGeneratingSample, setIsGeneratingSample] = useState(false);
  const [currentJob, setCurrentJob] = useState<JobProgress | null>(null);
  const [activeTab, setActiveTab] = useState<'upload' | 'sample'>('sample');

  // Hls player state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [availableLevels, setAvailableLevels] = useState<RenditionLevel[]>([]);
  const [currentLevelIndex, setCurrentLevelIndex] = useState<number>(-1); // -1 = Auto
  const [currentBitrate, setCurrentBitrate] = useState<number>(0);
  const [currentResolution, setCurrentResolution] = useState<string>('Auto (ABR)');
  const [playerError, setPlayerError] = useState<string | null>(null);

  // Delete modal state
  const [deleteModalAsset, setDeleteModalAsset] = useState<VideoAsset | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Copy state
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Hover preview state: map of asset.id -> boolean
  const [hoveredVideoId, setHoveredVideoId] = useState<string | null>(null);

  // Fetch all videos for current workspace
  const fetchVideos = async () => {
    setLoadingVideos(true);
    try {
      const res = await fetch('/api/v1/assets?asset_type=video&limit=24', {
        headers: {
          'X-Media-Api-Key': DEMO_CREDENTIALS.rawKey,
        },
      });
      if (!res.ok) throw new Error(`Lỗi tải danh sách video (${res.status})`);
      const json = await res.json();
      const list: VideoAsset[] = json.data || [];
      setVideos(list);

      // Auto select first video if none selected
      if (!activeVideo && list.length > 0) {
        setActiveVideo(list[0]);
      }
    } catch (err: any) {
      console.error('Fetch videos error:', err);
    } finally {
      setLoadingVideos(false);
    }
  };

  useEffect(() => {
    fetchVideos();
  }, []);

  // Initialize or update HLS when activeVideo changes
  useEffect(() => {
    if (!activeVideo || !videoRef.current) return;

    // Reset player state
    setPlayerError(null);
    setAvailableLevels([]);
    setCurrentLevelIndex(-1);
    setCurrentBitrate(0);
    setCurrentResolution('Đang kết nối...');

    const masterUrl = `/api/v1/delivery/video/${activeVideo.id}/master.m3u8`;

    // Clean up previous Hls instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        debug: false,
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
      });

      hlsRef.current = hls;
      hls.loadSource(masterUrl);
      hls.attachMedia(videoRef.current);

      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        const levels: RenditionLevel[] = data.levels.map((lvl, idx) => ({
          index: idx,
          name: lvl.name || `${lvl.height}p`,
          height: lvl.height,
          width: lvl.width,
          bitrate: lvl.bitrate,
        }));
        setAvailableLevels(levels);
        setCurrentResolution(levels.length > 0 ? `Auto (${levels[0].height}p)` : 'Auto');
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        const level = hls.levels[data.level];
        if (level) {
          setCurrentBitrate(level.bitrate);
          setCurrentResolution(`${level.width}x${level.height} (${(level.bitrate / 1000).toFixed(0)} kbps)`);
        }
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              if (data.response?.code === 425) {
                setPlayerError('Video đang trong quá trình transcoding. Vui lòng đợi trong giây lát...');
              } else {
                setPlayerError('Không thể tải luồng HLS (Network Error)');
              }
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              setPlayerError('Lỗi phát HLS: ' + data.details);
              hls.destroy();
              break;
          }
        }
      });
    } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS for Safari
      videoRef.current.src = masterUrl;
    } else {
      setPlayerError('Trình duyệt không hỗ trợ HLS adaptive streaming');
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [activeVideo]);

  // Trigger background worker to process job
  const triggerWorkerProcessing = async () => {
    try {
      await fetch('/api/v1/jobs/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Media-Api-Key': DEMO_CREDENTIALS.rawKey,
        },
        body: JSON.stringify({ worker_id: 'web_studio_worker' }),
      });
    } catch (e) {
      console.warn('Worker trigger sent (background processing)', e);
    }
  };

  // Poll job status until completed or failed
  const pollJobStatus = async (jobId: string, assetId: string) => {
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/jobs/${jobId}`, {
          headers: { 'X-Media-Api-Key': DEMO_CREDENTIALS.rawKey },
        });
        if (!res.ok) return;
        const json = await res.json();
        const job: JobProgress = json.data;
        setCurrentJob(job);

        if (job.status === 'completed') {
          clearInterval(pollInterval);
          toast.success('Xử lý HLS video hoàn tất thành công!');
          // Refresh video list & select the new asset
          await fetchVideos();
          setActiveVideo((prev) => (prev?.id === assetId ? prev : { id: assetId, display_name: 'Đang mở...', original_filename: '', mime_type: 'video/mp4', size_bytes: 0, created_at: '' }));
          // Fetch exact asset record
          const assetRes = await fetch(`/api/v1/assets/${assetId}`, {
            headers: { 'X-Media-Api-Key': DEMO_CREDENTIALS.rawKey },
          });
          if (assetRes.ok) {
            const assetJson = await assetRes.json();
            setActiveVideo(assetJson.data);
          }
        } else if (job.status === 'failed') {
          clearInterval(pollInterval);
          toast.error(`Quá trình transcode thất bại: ${job.error_message || 'Lỗi không xác định'}`);
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 1500);

    // Timeout safety 3 minutes
    setTimeout(() => clearInterval(pollInterval), 180000);
  };

  // Action: Generate Sample 720p Video
  const handleGenerateSample = async () => {
    setIsGeneratingSample(true);
    setCurrentJob(null);
    try {
      toast.info('Đang sinh video 720p H.264/AAC trực tiếp bằng FFmpeg...');
      const res = await fetch('/api/v1/demo/sample-video', {
        method: 'POST',
        headers: {
          'X-Media-Api-Key': DEMO_CREDENTIALS.rawKey,
        },
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error?.message || `HTTP ${res.status}`);
      }

      const json = await res.json();
      const asset = json.data;
      toast.success(`Đã tạo video mẫu thành công! Bắt đầu transcode HLS...`);

      setCurrentJob({
        id: asset.job_id,
        status: 'queued',
        current_stage: 'queued',
        progress: 10,
      });

      // Trigger worker in background
      triggerWorkerProcessing();

      // Poll job progress
      pollJobStatus(asset.job_id, asset.id);
    } catch (err: any) {
      toast.error(`Không thể tạo video mẫu: ${err.message}`);
    } finally {
      setIsGeneratingSample(false);
    }
  };

  // Action: Upload Video File
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('video/')) {
      toast.error('Vui lòng chọn file video hợp lệ (.mp4, .webm, .mov, .mkv)');
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      toast.error('Dung lượng video vượt quá giới hạn demo 50MB');
      return;
    }

    setIsUploading(true);
    setCurrentJob(null);
    try {
      toast.info(`Đang tải lên "${file.name}" (${(file.size / 1024 / 1024).toFixed(1)}MB)...`);
      const formData = new FormData();
      formData.append('file', file);
      formData.append('displayName', file.name);

      const res = await fetch('/api/v1/uploads', {
        method: 'POST',
        headers: {
          'X-Media-Api-Key': DEMO_CREDENTIALS.rawKey,
        },
        body: formData,
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error?.message || `HTTP ${res.status}`);
      }

      const json = await res.json();
      const asset = json.data;

      if (asset.job_id) {
        toast.success('Upload thành công! Bắt đầu pipeline xử lý HLS...');
        setCurrentJob({
          id: asset.job_id,
          status: 'queued',
          current_stage: 'queued',
          progress: 10,
        });

        // Trigger worker in background
        triggerWorkerProcessing();

        // Poll job progress
        pollJobStatus(asset.job_id, asset.id);
      } else {
        toast.success('Upload hoàn tất!');
        await fetchVideos();
      }
    } catch (err: any) {
      toast.error(`Upload thất bại: ${err.message}`);
    } finally {
      setIsUploading(false);
      // Reset input
      e.target.value = '';
    }
  };

  // Change rendition level in HLS player
  const handleSelectLevel = (levelIndex: number) => {
    if (!hlsRef.current) return;
    hlsRef.current.currentLevel = levelIndex;
    setCurrentLevelIndex(levelIndex);

    if (levelIndex === -1) {
      setCurrentResolution('Auto (ABR Dynamic)');
    } else {
      const lvl = availableLevels.find((l) => l.index === levelIndex);
      if (lvl) {
        setCurrentResolution(`${lvl.width}x${lvl.height} (${(lvl.bitrate / 1000).toFixed(0)} kbps)`);
      }
    }
    toast.info(`Đã chuyển profile: ${levelIndex === -1 ? 'Auto (ABR)' : availableLevels.find((l) => l.index === levelIndex)?.name}`);
  };

  // Safe Delete Video
  const handleExecuteDelete = async () => {
    if (!deleteModalAsset) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/v1/assets/${deleteModalAsset.id}?action=purge&force=true`, {
        method: 'DELETE',
        headers: {
          'X-Media-Api-Key': DEMO_CREDENTIALS.rawKey,
        },
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error?.message || `Lỗi HTTP ${res.status}`);
      }

      toast.success(`Đã xóa video "${deleteModalAsset.display_name}" cùng toàn bộ playlist và segments HLS!`);

      // If active video is deleted, switch
      if (activeVideo?.id === deleteModalAsset.id) {
        const remaining = videos.filter((v) => v.id !== deleteModalAsset.id);
        setActiveVideo(remaining.length > 0 ? remaining[0] : null);
      }

      setDeleteModalAsset(null);
      await fetchVideos();
    } catch (err: any) {
      toast.error(`Xóa video thất bại: ${err.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const copyToClipboard = (text: string, keyName: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(keyName);
    toast.success(`Đã sao chép ${label}!`);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <section id="video-studio" className="py-20 border-b border-slate-800/80 bg-slate-950/90 relative">
      {/* Background glow lights */}
      <div className="absolute top-1/4 left-10 w-96 h-96 bg-purple-600/10 blur-[130px] pointer-events-none -z-10 rounded-full" />
      <div className="absolute bottom-10 right-10 w-96 h-96 bg-sky-600/10 blur-[130px] pointer-events-none -z-10 rounded-full" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between mb-12 gap-4">
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-semibold px-2.5 py-1 rounded-md bg-gradient-to-r from-purple-500/10 to-sky-500/10 text-purple-300 border border-purple-500/20 mb-3">
              <Film className="w-3.5 h-3.5 text-purple-400" />
              <span>HLS Adaptive Video Engine v3.5</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              HLS Video Studio & Transcoding Engine
            </h2>
            <p className="mt-2 text-sm sm:text-base text-slate-400 max-w-3xl">
              Thử nghiệm toàn bộ pipeline media thế hệ mới: Upload không block, Adaptive HLS Ladder (1080p/720p/480p/360p),
              chuẩn hóa 30fps mượt mà, trích xuất Smart Poster WebP tự động, hover trailer hoạt ảnh WebP, và Fenced Safe Delete.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchVideos}
              disabled={loadingVideos}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-300 hover:text-white transition-all cursor-pointer disabled:opacity-50 min-h-[44px]"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingVideos ? 'animate-spin' : ''}`} />
              <span>Làm Mới Danh Sách</span>
            </button>
          </div>
        </div>

        {/* Action Panel: Upload or One-Click Sample */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-10">
          {/* Action Box */}
          <div className="lg:col-span-5 bg-slate-900/60 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between shadow-xl">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Thử Nghiệm Transcode
                </span>
                <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                  <button
                    onClick={() => setActiveTab('sample')}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                      activeTab === 'sample'
                        ? 'bg-purple-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    1-Click Mẫu
                  </button>
                  <button
                    onClick={() => setActiveTab('upload')}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                      activeTab === 'upload'
                        ? 'bg-sky-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Upload File
                  </button>
                </div>
              </div>

              {activeTab === 'sample' ? (
                <div className="space-y-4">
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Không cần chuẩn bị file nặng! Nhấn nút dưới đây để hệ thống sinh ngay một video mẫu 720p 30fps bằng lệnh FFmpeg trực tiếp trên server và đưa vào hàng đợi transcode HLS tự động.
                  </p>
                  <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 text-xs font-mono text-slate-400 space-y-1">
                    <div className="text-purple-400 font-semibold">Thông số video mẫu:</div>
                    <div>• Độ phân giải: 1280x720 (720p)</div>
                    <div>• Video Codec: H.264 High Profile (yuv420p)</div>
                    <div>• Audio Codec: AAC Stereo (128 kbps, 1kHz test sine)</div>
                    <div>• Tốc độ khung hình: Cố định 30.000 fps</div>
                  </div>
                  <button
                    onClick={handleGenerateSample}
                    disabled={isGeneratingSample || Boolean(currentJob && currentJob.status !== 'completed' && currentJob.status !== 'failed')}
                    className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-sm font-semibold shadow-lg shadow-purple-600/30 transition-all cursor-pointer disabled:opacity-50 min-h-[44px]"
                  >
                    {isGeneratingSample ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Đang sinh video mẫu...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 text-purple-200" />
                        <span>⚡ Tạo Video Mẫu 720p & Transcode HLS</span>
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Kéo thả hoặc duyệt file video MP4, WebM, MOV từ máy tính của bạn (tối đa 50MB). Upload không block ngay lập tức với HTTP 201.
                  </p>
                  <label className="block border-2 border-dashed border-slate-700/80 hover:border-sky-500/60 rounded-xl p-6 text-center cursor-pointer bg-slate-950/50 hover:bg-slate-950/80 transition-colors">
                    <input
                      type="file"
                      accept="video/mp4,video/webm,video/quicktime,video/x-matroska"
                      onChange={handleFileUpload}
                      disabled={isUploading}
                      className="hidden"
                    />
                    <UploadCloud className="w-8 h-8 text-sky-400 mx-auto mb-2" />
                    <span className="text-xs font-semibold text-slate-200 block">
                      {isUploading ? 'Đang tải lên server...' : 'Nhấp để chọn file hoặc kéo thả vào đây'}
                    </span>
                    <span className="text-[11px] text-slate-500 mt-1 block">MP4, WebM, MOV (Tối đa 50MB)</span>
                  </label>
                </div>
              )}
            </div>

            {/* Quick API Key indicator */}
            <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
              <span>Demo Key: <code className="text-sky-400 font-mono">mda_live_demo2026...</code></span>
              <span className="text-emerald-400 font-medium">Full Access</span>
            </div>
          </div>

          {/* Job Pipeline Tracker */}
          <div className="lg:col-span-7 bg-slate-900/60 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between shadow-xl">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-sky-400 animate-pulse" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Trạng Thái Hàng Đợi & Pipeline Transcoding
                  </h3>
                </div>
                {currentJob && (
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-mono uppercase font-semibold ${
                    currentJob.status === 'completed'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                      : currentJob.status === 'failed'
                      ? 'bg-red-500/10 text-red-400 border border-red-500/30'
                      : 'bg-sky-500/10 text-sky-400 border border-sky-500/30'
                  }`}>
                    {currentJob.status}
                  </span>
                )}
              </div>

              {currentJob ? (
                <div className="space-y-4">
                  {/* Progress Bar */}
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1.5 font-mono">
                      <span className="text-slate-400">Tiến độ tổng thể:</span>
                      <span className="text-sky-400 font-bold">{currentJob.progress || 10}%</span>
                    </div>
                    <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden p-0.5 border border-slate-800">
                      <div
                        className="h-full bg-gradient-to-r from-sky-500 via-indigo-500 to-emerald-400 rounded-full transition-all duration-500 shadow-sm"
                        style={{ width: `${Math.max(10, currentJob.progress || 10)}%` }}
                      />
                    </div>
                  </div>

                  {/* Stage Stepper Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-2">
                    {STAGES.map((stage) => {
                      const isPast = (currentJob.progress || 10) >= stage.pct;
                      const isCurrent = currentJob.current_stage === stage.id;
                      return (
                        <div
                          key={stage.id}
                          className={`p-2.5 rounded-xl border text-xs transition-all ${
                            isPast
                              ? 'bg-emerald-500/5 border-emerald-500/30 text-slate-200'
                              : isCurrent
                              ? 'bg-sky-500/10 border-sky-500/50 text-white ring-1 ring-sky-500/30'
                              : 'bg-slate-950/40 border-slate-800/80 text-slate-500'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-semibold truncate">{stage.label}</span>
                            {isPast ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            ) : isCurrent ? (
                              <RefreshCw className="w-3.5 h-3.5 text-sky-400 animate-spin shrink-0" />
                            ) : (
                              <Clock className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                            )}
                          </div>
                          <p className="text-[10px] text-slate-400 line-clamp-1">{stage.desc}</p>
                        </div>
                      );
                    })}
                  </div>

                  {/* Job Specs details */}
                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono text-slate-400">
                    <div>
                      <span className="text-slate-600 block">JOB ID:</span>
                      <span className="text-slate-300 truncate block">{currentJob.id}</span>
                    </div>
                    <div>
                      <span className="text-slate-600 block">STAGE:</span>
                      <span className="text-sky-400 font-semibold">{currentJob.current_stage || 'queued'}</span>
                    </div>
                    <div>
                      <span className="text-slate-600 block">ATTEMPT:</span>
                      <span className="text-slate-300">{currentJob.attempt || 1} / 3</span>
                    </div>
                    <div>
                      <span className="text-slate-600 block">OUTPUT VER:</span>
                      <span className="text-purple-400">{currentJob.output_version || 'pending'}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-10 text-center text-slate-500 flex flex-col items-center justify-center">
                  <Layers className="w-10 h-10 text-slate-700 mb-2" />
                  <p className="text-xs text-slate-400 font-medium">Hàng đợi đang ở trạng thái rảnh (Idle)</p>
                  <p className="text-[11px] text-slate-600 max-w-sm mt-1">
                    Nhấn nút &ldquo;⚡ Tạo Video Mẫu 720p&rdquo; hoặc tải lên một video mới để theo dõi chu kỳ 6 giai đoạn transcode thời gian thực.
                  </p>
                </div>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between text-xs text-slate-400">
              <span>Độ trễ phản hồi Upload: <strong className="text-emerald-400 font-mono">&lt; 300ms</strong></span>
              <span>Lease Fencing: <strong className="text-purple-400 font-mono">Heartbeat Active</strong></span>
            </div>
          </div>
        </div>

        {/* Main HLS Adaptive Player & Telemetry HUD */}
        {activeVideo ? (
          <div className="bg-slate-900/80 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl mb-12">
            {/* Player Header Bar */}
            <div className="px-6 py-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-950/60">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-400">
                  <Play className="w-4 h-4 fill-current" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    {activeVideo.display_name}
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                      HLS Master Active
                    </span>
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-slate-400 font-mono mt-0.5">
                    <span>ID: {activeVideo.id}</span>
                    <span>•</span>
                    <span>Gốc: {formatSize(activeVideo.size_bytes)}</span>
                    <span>•</span>
                    <span>30.000 FPS</span>
                  </div>
                </div>
              </div>

              {/* Rendition Selector Pill Dropdown */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 font-mono hidden sm:inline">Chất lượng:</span>
                <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
                  <button
                    onClick={() => handleSelectLevel(-1)}
                    className={`px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer min-h-[36px] ${
                      currentLevelIndex === -1
                        ? 'bg-sky-500 text-white shadow-md'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Auto (ABR)
                  </button>
                  {availableLevels.map((lvl) => (
                    <button
                      key={lvl.index}
                      onClick={() => handleSelectLevel(lvl.index)}
                      className={`px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer min-h-[36px] ${
                        currentLevelIndex === lvl.index
                          ? 'bg-purple-600 text-white shadow-md'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {lvl.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Video Player Display */}
            <div className="relative aspect-video bg-black flex items-center justify-center overflow-hidden">
              <video
                ref={videoRef}
                controls
                playsInline
                poster={`/api/v1/delivery/video/${activeVideo.id}/poster.webp`}
                className="w-full h-full object-contain"
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              />

              {/* Error overlay if any */}
              {playerError && (
                <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center p-6 text-center z-20">
                  <AlertTriangle className="w-12 h-12 text-amber-400 mb-3" />
                  <h4 className="text-base font-semibold text-white mb-1">Chưa sẵn sàng phát HLS</h4>
                  <p className="text-xs text-slate-400 max-w-md font-mono mb-4">{playerError}</p>
                  <button
                    onClick={() => {
                      setPlayerError(null);
                      const masterUrl = `/api/v1/delivery/video/${activeVideo.id}/master.m3u8`;
                      if (hlsRef.current) {
                        hlsRef.current.loadSource(masterUrl);
                      }
                    }}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 cursor-pointer min-h-[44px]"
                  >
                    Thử tải lại luồng
                  </button>
                </div>
              )}

              {/* Telemetry Badge in bottom corner */}
              <div className="absolute top-4 right-4 bg-slate-950/80 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-700/80 text-[11px] font-mono text-slate-300 flex items-center gap-3 z-10 pointer-events-none">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  {currentResolution}
                </span>
                {currentBitrate > 0 && (
                  <>
                    <span>•</span>
                    <span className="text-sky-300">{(currentBitrate / 1000).toFixed(0)} kbps</span>
                  </>
                )}
                <span>•</span>
                <span className="text-purple-300">H.264 / AAC</span>
              </div>
            </div>

            {/* Bottom Actions & URLs */}
            <div className="p-6 bg-slate-950/90 border-t border-slate-800 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full lg:w-auto flex-1">
                {/* Master M3U8 */}
                <div className="bg-slate-900 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
                  <div className="truncate mr-2">
                    <span className="text-[10px] text-slate-500 block font-mono">MASTER M3U8:</span>
                    <span className="text-xs text-sky-400 font-mono truncate block">
                      /api/v1/delivery/video/{activeVideo.id}/master.m3u8
                    </span>
                  </div>
                  <button
                    onClick={() =>
                      copyToClipboard(
                        `${window.location.origin}/api/v1/delivery/video/${activeVideo.id}/master.m3u8`,
                        'master',
                        'URL Master M3U8'
                      )
                    }
                    className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 cursor-pointer shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
                    title="Sao chép Master M3U8"
                  >
                    {copiedKey === 'master' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>

                {/* Smart Poster */}
                <div className="bg-slate-900 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
                  <div className="truncate mr-2">
                    <span className="text-[10px] text-slate-500 block font-mono">SMART POSTER (1.0s):</span>
                    <span className="text-xs text-purple-400 font-mono truncate block">
                      /api/v1/delivery/video/{activeVideo.id}/poster.webp
                    </span>
                  </div>
                  <button
                    onClick={() =>
                      copyToClipboard(
                        `${window.location.origin}/api/v1/delivery/video/${activeVideo.id}/poster.webp`,
                        'poster',
                        'URL Poster WebP'
                      )
                    }
                    className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 cursor-pointer shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
                    title="Sao chép Poster WebP"
                  >
                    {copiedKey === 'poster' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>

                {/* Animated Trailer */}
                <div className="bg-slate-900 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
                  <div className="truncate mr-2">
                    <span className="text-[10px] text-slate-500 block font-mono">HOVER TRAILER (3s):</span>
                    <span className="text-xs text-emerald-400 font-mono truncate block">
                      /api/v1/delivery/video/{activeVideo.id}/trailer.webp
                    </span>
                  </div>
                  <button
                    onClick={() =>
                      copyToClipboard(
                        `${window.location.origin}/api/v1/delivery/video/${activeVideo.id}/trailer.webp`,
                        'trailer',
                        'URL Trailer WebP'
                      )
                    }
                    className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 cursor-pointer shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center"
                    title="Sao chép Trailer WebP"
                  >
                    {copiedKey === 'trailer' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Danger Action: Delete Video */}
              <button
                onClick={() => setDeleteModalAsset(activeVideo)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 hover:text-red-200 text-xs font-semibold transition-all cursor-pointer shrink-0 min-h-[44px]"
              >
                <Trash2 className="w-4 h-4" />
                <span>Xóa Video Này</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-slate-900/40 border border-slate-800 rounded-3xl p-12 text-center mb-12 flex flex-col items-center justify-center">
            <div className="w-14 h-14 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 mb-3">
              <Film className="w-7 h-7" />
            </div>
            <h4 className="text-lg font-bold text-white mb-1">Trình Phát HLS Adaptive Video</h4>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Hỗ trợ tự động chuyển đổi độ phân giải Auto (ABR), 720p, 480p, 360p, cố định 30fps mượt mà, và Smart Poster WebP.
            </p>
          </div>
        )}

        {/* Video Catalog & Hover Animated Trailer Grid */}
        <div>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-xl font-bold text-white tracking-tight">
                Kho Video Trong Workspace ({videos.length})
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Rê chuột qua từng video để xem ảnh hoạt họa Trailer WebP 3 giây tự động tải từ CDN.
              </p>
            </div>
          </div>

          {loadingVideos ? (
            <div className="py-16 text-center text-slate-400">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-sky-400" />
              <p className="text-xs font-mono">Đang tải kho video...</p>
            </div>
          ) : videos.length === 0 ? (
            <div className="py-16 text-center bg-slate-900/30 rounded-2xl border border-dashed border-slate-800">
              <Film className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-sm text-slate-400">Chưa có video nào trong workspace.</p>
              <button
                onClick={handleGenerateSample}
                className="mt-4 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold cursor-pointer min-h-[44px]"
              >
                Tạo Video Mẫu Đầu Tiên
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {videos.map((v) => {
                const isSelected = activeVideo?.id === v.id;
                const isHovered = hoveredVideoId === v.id;
                const posterUrl = `/api/v1/delivery/video/${v.id}/poster.webp`;
                const trailerUrl = `/api/v1/delivery/video/${v.id}/trailer.webp`;

                return (
                  <div
                    key={v.id}
                    onClick={() => {
                      setActiveVideo(v);
                      window.scrollTo({ top: 400, behavior: 'smooth' });
                    }}
                    onMouseEnter={() => setHoveredVideoId(v.id)}
                    onMouseLeave={() => setHoveredVideoId(null)}
                    className={`group bg-slate-900/60 hover:bg-slate-900 border rounded-2xl overflow-hidden shadow-lg transition-all duration-300 flex flex-col cursor-pointer ${
                      isSelected
                        ? 'border-purple-500 ring-2 ring-purple-500/30 shadow-purple-500/10'
                        : 'border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {/* Thumbnail area with Hover Animated Trailer WebP */}
                    <div className="relative aspect-video bg-slate-950 overflow-hidden border-b border-slate-800/80">
                      <img
                        src={isHovered ? trailerUrl : posterUrl}
                        alt={v.display_name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        onError={(e) => {
                          // Fallback if poster or trailer not yet generated
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />

                      {/* Badge format */}
                      <div className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-md bg-slate-950/80 backdrop-blur-md text-[10px] font-mono font-bold text-slate-300 border border-slate-700/80">
                        HLS STREAM
                      </div>

                      {/* Hover Indicator */}
                      <div className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-md bg-purple-950/80 backdrop-blur-md text-[10px] font-mono text-purple-300 border border-purple-700/60 opacity-0 group-hover:opacity-100 transition-opacity">
                        {isHovered ? 'Trailer Loop' : '30fps WebP'}
                      </div>

                      {/* Play overlay button */}
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-slate-950/30 pointer-events-none">
                        <div className="w-10 h-10 rounded-full bg-purple-600/90 text-white flex items-center justify-center shadow-lg">
                          <Play className="w-5 h-5 fill-current ml-0.5" />
                        </div>
                      </div>
                    </div>

                    {/* Card Body */}
                    <div className="p-4 flex-1 flex flex-col justify-between">
                      <div>
                        <h4 className="font-semibold text-sm text-slate-200 group-hover:text-purple-300 transition-colors line-clamp-1">
                          {v.display_name}
                        </h4>
                        <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-1 font-mono">
                          <span>{formatSize(v.size_bytes)}</span>
                          <span>•</span>
                          <span>{v.width && v.height ? `${v.width}x${v.height}` : '720p'}</span>
                          <span>•</span>
                          <span>30 fps</span>
                        </div>
                      </div>

                      {/* Bottom action row */}
                      <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                        <span className="text-[10px] text-slate-500 font-mono truncate max-w-[120px]">
                          {v.id}
                        </span>

                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              copyToClipboard(
                                `${window.location.origin}/api/v1/delivery/video/${v.id}/master.m3u8`,
                                v.id,
                                'URL M3U8'
                              );
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-sky-400 hover:bg-slate-800 cursor-pointer min-h-[36px] min-w-[36px] flex items-center justify-center"
                            title="Sao chép M3U8"
                          >
                            {copiedKey === v.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteModalAsset(v);
                            }}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 cursor-pointer min-h-[36px] min-w-[36px] flex items-center justify-center"
                            title="Xóa video"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Safe Delete Confirmation Modal */}
      {deleteModalAsset && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setDeleteModalAsset(null)}
        >
          <div
            className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 text-red-400">
              <div className="w-10 h-10 rounded-full bg-red-500/20 border border-red-500/30 flex items-center justify-center">
                <ShieldAlert className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="font-bold text-base text-white">Xác Nhận Xóa Video</h3>
                <span className="text-xs text-slate-400">Zero-Ghost Safe Delete Guard</span>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Bạn đang chuẩn bị xóa video <strong className="text-white font-mono">{deleteModalAsset.display_name}</strong> (ID: {deleteModalAsset.id}).
            </p>

            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-300 space-y-1 font-mono">
              <div>Thao tác này sẽ dọn dẹp triệt để:</div>
              <div>• File gốc trong storage (uploads/...)</div>
              <div>• Master playlist HLS & toàn bộ các variant .m3u8</div>
              <div>• Toàn bộ các file video segments (.ts) 720p/480p/360p</div>
              <div>• Poster WebP & Animated Trailer WebP</div>
              <div>• Bản ghi trong cơ sở dữ liệu Postgres</div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setDeleteModalAsset(null)}
                disabled={isDeleting}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer min-h-[44px]"
              >
                Hủy Bỏ
              </button>
              <button
                onClick={handleExecuteDelete}
                disabled={isDeleting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold shadow-lg shadow-red-600/30 transition-all cursor-pointer disabled:opacity-50 min-h-[44px]"
              >
                {isDeleting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Đang xóa triệt để...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Xác Nhận Xóa Vĩnh Viễn</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
