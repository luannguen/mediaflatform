'use client';

import { useState, useEffect } from 'react';
import { Asset, AssetReference, ProcessingJob } from '@/types/database';
import {
  X,
  Copy,
  Check,
  Trash2,
  ShieldAlert,
  ExternalLink,
  Layers,
  Database,
  Calendar,
  FileText,
  Info,
  Target,
  Palette,
  Play,
  Film,
  Sparkles,
  RefreshCw,
  AlertCircle,
  Clock,
  Boxes,
  FolderTree,
  Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import { useFolders } from '@/hooks/useFolders';
import { useCollections } from '@/hooks/useCollections';

interface AssetDetailDrawerProps {
  asset: Asset | null;
  onClose: () => void;
  onTrash: (id: string) => void;
  onPurge: (id: string, force: boolean) => void;
}

export function AssetDetailDrawer({ asset, onClose, onTrash, onPurge }: AssetDetailDrawerProps) {
  const [activeTab, setActiveTab] = useState<'info' | 'studio' | 'usage' | 'storage'>('info');
  const [references, setReferences] = useState<AssetReference[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Focal Point & Studio State
  const [focalPoint, setFocalPoint] = useState<{ x: number; y: number }>({
    x: asset?.metadata_json?.focal_point?.x ?? 0.5,
    y: asset?.metadata_json?.focal_point?.y ?? 0.5,
  });
  const [savingFocal, setSavingFocal] = useState(false);

  useEffect(() => {
    if (asset?.metadata_json?.focal_point) {
      setFocalPoint({
        x: asset.metadata_json.focal_point.x,
        y: asset.metadata_json.focal_point.y,
      });
    } else {
      setFocalPoint({ x: 0.5, y: 0.5 });
    }
  }, [asset]);

  useEffect(() => {
    if (!asset) return;

    // Fetch references for this asset
    setLoadingRefs(true);
    fetch(`/api/v1/assets/${asset.id}/references`)
      .then((res) => res.json())
      .then((json) => {
        if (json.data) setReferences(json.data);
      })
      .catch((err) => console.error('Failed to load references', err))
      .finally(() => setLoadingRefs(false));
  }, [asset]);

  // Folders & Collections
  const { folders } = useFolders();
  const { collections, addAssetToCollection, removeAssetFromCollection } = useCollections();
  const [assetCollections, setAssetCollections] = useState<{ id: string; name: string }[]>([]);
  const [selectedColToAdd, setSelectedColToAdd] = useState('');
  const [addingCol, setAddingCol] = useState(false);

  useEffect(() => {
    if (!asset) {
      setAssetCollections([]);
      return;
    }
    fetch(`/api/v1/assets/${asset.id}/collections`)
      .then((res) => res.json())
      .then((json) => {
        if (json.data) setAssetCollections(json.data);
      })
      .catch(() => {});
  }, [asset]);

  const handleAddToCollection = async () => {
    if (!asset || !selectedColToAdd) return;
    setAddingCol(true);
    const success = await addAssetToCollection(selectedColToAdd, asset.id);
    if (success) {
      const col = collections.find((c) => c.id === selectedColToAdd);
      if (col && !assetCollections.some((c) => c.id === col.id)) {
        setAssetCollections((prev) => [...prev, { id: col.id, name: col.name }]);
      }
      setSelectedColToAdd('');
    }
    setAddingCol(false);
  };

  const handleRemoveFromCollection = async (collectionId: string) => {
    if (!asset) return;
    const success = await removeAssetFromCollection(collectionId, asset.id);
    if (success) {
      setAssetCollections((prev) => prev.filter((c) => c.id !== collectionId));
    }
  };

  // Video Processing Job State & Polling
  const [job, setJob] = useState<ProcessingJob | null>(null);
  const [processingAction, setProcessingAction] = useState(false);

  useEffect(() => {
    if (!asset || asset.asset_type !== 'video') {
      setJob(null);
      return;
    }

    let timer: NodeJS.Timeout | null = null;
    let isMounted = true;

    const fetchJob = async () => {
      try {
        const res = await fetch(`/api/v1/assets/${asset.id}/job`);
        const json = await res.json();
        if (isMounted && json.data?.job) {
          setJob(json.data.job);
          if (
            json.data.job.status === 'queued' ||
            json.data.job.status === 'processing' ||
            json.data.job.status === 'retrying'
          ) {
            timer = setTimeout(fetchJob, 2500);
          }
        }
      } catch {
        // Non-fatal polling error
      }
    };

    fetchJob();
    return () => {
      isMounted = false;
      if (timer) clearTimeout(timer);
    };
  }, [asset]);

  const handleProcessJob = async () => {
    if (!job) return;
    setProcessingAction(true);
    try {
      const res = await fetch('/api/v1/jobs/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: job.id }),
      });
      const data = await res.json();
      if (res.ok && data.data?.job) {
        setJob(data.data.job);
        toast.success('Đã hoàn tất xử lý HLS Adaptive Video!');
        if (asset) asset.processing_status = 'ready';
      } else {
        toast.error(data.error?.message || 'Xử lý thất bại');
      }
    } catch {
      toast.error('Lỗi kết nối khi kích hoạt xử lý');
    } finally {
      setProcessingAction(false);
    }
  };

  const handleRetryJob = async (resetAttempts: boolean = false) => {
    if (!job) return;
    setProcessingAction(true);
    try {
      const res = await fetch(`/api/v1/jobs/${job.id}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset_attempts: resetAttempts }),
      });
      const data = await res.json();
      if (res.ok && data.data?.job) {
        setJob(data.data.job);
        toast.success(
          resetAttempts
            ? `Đã hồi sinh job từ DLQ (Reset về lần 1)!`
            : `Đã đưa job vào hàng đợi thử lại (Attempt ${data.data.job.attempt})`
        );
        if (asset) asset.processing_status = 'pending';
      } else {
        toast.error(data.error?.message || 'Không thể thử lại');
      }
    } catch {
      toast.error('Lỗi kết nối khi gửi yêu cầu thử lại');
    } finally {
      setProcessingAction(false);
    }
  };

  const handleSaveFocalPoint = async () => {
    if (!asset) return;
    setSavingFocal(true);
    try {
      const res = await fetch(`/api/v1/assets/${asset.id}/focal-point`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: focalPoint.x, y: focalPoint.y }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(`Tâm điểm tiêu cự đã lưu: (${Math.round(focalPoint.x * 100)}%, ${Math.round(focalPoint.y * 100)}%)`);
        if (asset.metadata_json) {
          asset.metadata_json.focal_point = { x: focalPoint.x, y: focalPoint.y };
        }
      } else {
        toast.error(data.error?.message || 'Không thể lưu tâm điểm');
      }
    } catch (err) {
      toast.error('Lỗi kết nối khi lưu tâm điểm');
    } finally {
      setSavingFocal(false);
    }
  };

  const handleImageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const x = Math.max(0, Math.min(1, Math.round((clickX / rect.width) * 100) / 100));
    const y = Math.max(0, Math.min(1, Math.round((clickY / rect.height) * 100) / 100));
    setFocalPoint({ x, y });
  };

  if (!asset) return null;

  const copyText = (text: string, isUrl: boolean = false) => {
    navigator.clipboard.writeText(text);
    if (isUrl) {
      setCopiedUrl(true);
      toast.success('Copied Delivery URL');
      setTimeout(() => setCopiedUrl(false), 2000);
    } else {
      setCopiedId(true);
      toast.success(`Copied Asset ID: ${text}`);
      setTimeout(() => setCopiedId(false), 2000);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const paletteColors: string[] =
    asset.metadata_json?.palette?.colors || ['#6366F1', '#3B82F6', '#10B981', '#F59E0B', '#EF4444'];

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-slate-900 border-l border-slate-800 shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
        <div>
          <h2 className="text-base font-semibold text-slate-100 truncate max-w-sm">{asset.display_name}</h2>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs font-mono text-violet-400">{asset.id}</span>
            <button
              onClick={() => copyText(asset.id)}
              className="text-slate-400 hover:text-slate-200"
              title="Copy ID"
            >
              {copiedId ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            </button>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Media Preview Box */}
      <div className="h-64 bg-slate-950 flex items-center justify-center border-b border-slate-800 relative overflow-hidden">
        {asset.asset_type === 'image' && asset.storage_url ? (
          <img src={asset.storage_url} alt={asset.display_name} className="max-h-full max-w-full object-contain" />
        ) : asset.asset_type === 'video' ? (
          <div className="flex flex-col items-center text-slate-400 gap-2">
            <Film className="h-16 w-16 text-violet-400 animate-pulse" />
            <span className="text-xs font-medium uppercase tracking-wider text-violet-300">Video Asset (HLS Ready)</span>
          </div>
        ) : (
          <div className="flex flex-col items-center text-slate-400 gap-2">
            <FileText className="h-16 w-16 text-slate-400" />
            <span className="text-xs font-medium uppercase tracking-wider">{asset.mime_type}</span>
          </div>
        )}

        {asset.storage_url && (
          <button
            onClick={() => copyText(asset.storage_url!, true)}
            className="absolute bottom-3 right-3 px-2.5 py-1.5 rounded-lg bg-slate-900/90 hover:bg-violet-600 text-xs font-medium text-slate-200 hover:text-white border border-slate-700 flex items-center gap-1.5 shadow-lg transition"
          >
            {copiedUrl ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            <span>Copy URL</span>
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800 bg-slate-950/30 px-4 overflow-x-auto">
        <button
          onClick={() => setActiveTab('info')}
          className={`px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition ${
            activeTab === 'info'
              ? 'border-violet-500 text-violet-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          General Info
        </button>
        <button
          onClick={() => setActiveTab('studio')}
          className={`px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap flex items-center gap-1.5 transition ${
            activeTab === 'studio'
              ? 'border-violet-500 text-violet-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sparkles className="h-3.5 w-3.5 text-violet-400" />
          <span>Studio & Palette</span>
        </button>
        <button
          onClick={() => setActiveTab('usage')}
          className={`px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap flex items-center gap-1.5 transition ${
            activeTab === 'usage'
              ? 'border-violet-500 text-violet-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>Usage</span>
          {references.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-violet-600/30 text-violet-300 font-mono">
              {references.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('storage')}
          className={`px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition ${
            activeTab === 'storage'
              ? 'border-violet-500 text-violet-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Storage
        </button>
      </div>

      {/* Tab Content Area */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm">
        {activeTab === 'info' && (
          <div className="space-y-3">
            <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800 space-y-2">
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Filename</span>
                <span className="text-slate-200 font-medium truncate max-w-xs">{asset.original_filename}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">File Type</span>
                <span className="text-slate-200 uppercase">{asset.asset_type}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">MIME Type</span>
                <span className="text-slate-200 font-mono text-xs">{asset.mime_type}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">File Size</span>
                <span className="text-slate-200">{formatSize(asset.size_bytes)}</span>
              </div>
              {asset.width && asset.height && (
                <div className="flex justify-between py-1 border-b border-slate-800/60">
                  <span className="text-slate-400">Dimensions</span>
                  <span className="text-slate-200 font-mono">{asset.width} × {asset.height} px</span>
                </div>
              )}
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Created At</span>
                <span className="text-slate-200">{new Date(asset.created_at).toLocaleString()}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-400">Folder</span>
                <span className="text-slate-200 font-medium">
                  {asset.folder_id ? folders.find((f) => f.id === asset.folder_id)?.name || asset.folder_id : 'Root Library (None)'}
                </span>
              </div>
            </div>

            {/* Curated Collections Section */}
            <div className="bg-slate-950/60 p-3.5 rounded-lg border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Boxes className="h-4 w-4 text-violet-400" />
                  <span>Curated Collections</span>
                </span>
                <span className="text-[11px] text-slate-400 font-mono">
                  {assetCollections.length} collections
                </span>
              </div>

              {/* Badges of current collections */}
              <div className="flex flex-wrap gap-1.5 min-h-[28px] items-center">
                {assetCollections.length > 0 ? (
                  assetCollections.map((col) => (
                    <span
                      key={col.id}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-purple-950/80 text-purple-300 border border-purple-800/50 shadow-sm"
                    >
                      <span>{col.name}</span>
                      <button
                        onClick={() => handleRemoveFromCollection(col.id)}
                        className="hover:text-rose-400 text-purple-400/80 transition ml-1"
                        title="Remove from collection"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-slate-500 italic">This asset does not belong to any collection</span>
                )}
              </div>

              {/* Add to collection dropdown */}
              {collections.length > 0 && (
                <div className="pt-2 border-t border-slate-800/60 flex items-center gap-2">
                  <select
                    value={selectedColToAdd}
                    onChange={(e) => setSelectedColToAdd(e.target.value)}
                    className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-violet-500"
                  >
                    <option value="">Add to collection...</option>
                    {collections
                      .filter((c) => !assetCollections.some((ac) => ac.id === c.id))
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                  <button
                    onClick={handleAddToCollection}
                    disabled={!selectedColToAdd || addingCol}
                    className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-medium flex items-center gap-1 transition shadow-sm"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>{addingCol ? 'Adding...' : 'Add'}</span>
                  </button>
                </div>
              )}
            </div>

            {asset.description && (
              <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                  Description
                </span>
                <p className="text-slate-300 text-sm">{asset.description}</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'studio' && (
          <div className="space-y-4">
            {asset.asset_type === 'image' && asset.storage_url ? (
              <>
                {/* Visual Focal Point Studio */}
                <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Target className="h-4 w-4 text-violet-400" />
                      <span className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                        Focal Point Cropping (Tâm Điểm)
                      </span>
                    </div>
                    <span className="text-xs font-mono text-violet-400 bg-violet-950/60 px-2 py-0.5 rounded border border-violet-800/40">
                      X: {Math.round(focalPoint.x * 100)}% | Y: {Math.round(focalPoint.y * 100)}%
                    </span>
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed">
                    Nhấp chuột lên ảnh để ghim tâm điểm giữ nét. Khi app gọi CDN với <code className="text-violet-300">fit=focal</code> hoặc <code className="text-violet-300">crop=focal</code>, thuật toán Sharp sẽ luôn định vị tâm điểm này ở giữa khung hình.
                  </p>

                  {/* Interactive Crosshair Box */}
                  <div
                    onClick={handleImageClick}
                    className="relative w-full h-52 bg-slate-900 rounded-lg overflow-hidden border border-slate-700/80 cursor-crosshair group flex items-center justify-center select-none"
                  >
                    <img
                      src={asset.storage_url}
                      alt="Focal selector"
                      className="w-full h-full object-contain pointer-events-none"
                    />

                    {/* Target Pin Marker */}
                    <div
                      className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none transition-all duration-75 flex items-center justify-center"
                      style={{
                        left: `${focalPoint.x * 100}%`,
                        top: `${focalPoint.y * 100}%`,
                      }}
                    >
                      <div className="w-8 h-8 rounded-full border-2 border-emerald-400 bg-emerald-500/20 flex items-center justify-center shadow-lg shadow-emerald-500/50 animate-pulse">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      </div>
                      <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-slate-950/90 text-[10px] font-mono text-emerald-300 whitespace-nowrap border border-emerald-500/40 shadow">
                        {Math.round(focalPoint.x * 100)}%, {Math.round(focalPoint.y * 100)}%
                      </span>
                    </div>

                    <div className="absolute inset-x-0 bottom-1 text-center pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="text-[11px] bg-slate-950/80 text-slate-300 px-2 py-0.5 rounded">
                        Click bất kỳ đâu để đổi tâm điểm
                      </span>
                    </div>
                  </div>

                  {/* Save Button */}
                  <button
                    onClick={handleSaveFocalPoint}
                    disabled={savingFocal}
                    className="w-full py-2 px-3 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-medium flex items-center justify-center gap-2 shadow-md transition"
                  >
                    <Target className="h-3.5 w-3.5" />
                    <span>{savingFocal ? 'Đang lưu...' : 'Lưu Tâm Điểm Tiêu Cự'}</span>
                  </button>

                  {/* Dynamic CDN Example */}
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-400 space-y-1">
                    <span className="font-medium text-slate-300 block">Ví dụ URL Smart Crop:</span>
                    <code className="text-violet-300 font-mono break-all block">
                      /api/v1/delivery/{asset.id}?width=400&height=300&fit=focal
                    </code>
                  </div>
                </div>

                {/* Dominant Palette Studio */}
                <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Palette className="h-4 w-4 text-violet-400" />
                      <span className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                        5-Color Dominant Palette
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400">Sharp C++ Extract</span>
                  </div>

                  {/* Color Swatches */}
                  <div className="grid grid-cols-5 gap-2">
                    {paletteColors.map((color, idx) => (
                      <button
                        key={idx}
                        onClick={() => copyText(color)}
                        className="flex flex-col items-center gap-1 group"
                        title={`Copy ${color}`}
                      >
                        <div
                          className="w-full h-10 rounded-lg border border-slate-700 shadow-sm group-hover:scale-105 group-hover:border-white transition relative flex items-center justify-center"
                          style={{ backgroundColor: color }}
                        >
                          <Copy className="h-3 w-3 text-white opacity-0 group-hover:opacity-100 drop-shadow" />
                        </div>
                        <span className="text-[10px] font-mono text-slate-300 group-hover:text-violet-300 uppercase">
                          {color}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* CSS Gradient Generator */}
                  <div className="pt-2 border-t border-slate-800/80 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">CSS Gradient Preview:</span>
                      <button
                        onClick={() => {
                          const gradCss = `linear-gradient(135deg, ${paletteColors[0]} 0%, ${paletteColors[1] || paletteColors[0]} 50%, ${paletteColors[2] || paletteColors[0]} 100%)`;
                          copyText(gradCss);
                          toast.success('Đã copy mã CSS Gradient');
                        }}
                        className="text-violet-400 hover:text-violet-300 text-[11px] flex items-center gap-1 font-medium"
                      >
                        <Copy className="h-3 w-3" />
                        <span>Copy CSS</span>
                      </button>
                    </div>

                    <div
                      className="h-7 rounded-lg border border-slate-700 shadow-inner"
                      style={{
                        background: `linear-gradient(90deg, ${paletteColors.join(', ')})`,
                      }}
                    />
                  </div>
                </div>
              </>
            ) : asset.asset_type === 'video' ? (
              /* Video HLS & Processing Job Studio */
              <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Film className="h-4 w-4 text-violet-400" />
                    <span className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                      HLS Video Streaming & Worker
                    </span>
                  </div>
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/50">
                    Non-Upscaling HLS
                  </span>
                </div>

                {/* Job Processing State Card */}
                {(job?.status === 'queued' ||
                  job?.status === 'processing' ||
                  asset.processing_status === 'pending' ||
                  asset.processing_status === 'processing') && (
                  <div className="p-3 rounded-lg bg-violet-950/40 border border-violet-800/50 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-violet-300 text-xs font-medium">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin text-violet-400" />
                        <span>Background Transcoding Active</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {job?.locked_by && (
                          <span className="text-[9px] font-mono text-violet-400 bg-violet-950 px-1.5 py-0.5 rounded border border-violet-800">
                            {job.locked_by.slice(0, 14)}
                          </span>
                        )}
                        <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-violet-900/60 text-violet-200 border border-violet-700">
                          {job?.current_stage || 'Queued'}
                        </span>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
                      <div
                        className="bg-violet-500 h-full transition-all duration-300 ease-out"
                        style={{ width: `${job?.progress || 10}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>Tiến trình: {job?.progress || 0}%</span>
                      {job?.attempt && job.attempt > 1 && (
                        <span className="text-amber-400">Attempt {job.attempt}</span>
                      )}
                    </div>

                    <button
                      onClick={handleProcessJob}
                      disabled={processingAction}
                      className="w-full py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-medium transition flex items-center justify-center gap-1.5 shadow"
                    >
                      <RefreshCw className={`h-3 w-3 ${processingAction ? 'animate-spin' : ''}`} />
                      <span>{processingAction ? 'Đang chạy Worker...' : 'Xử lý ngay (Run Worker Now)'}</span>
                    </button>
                  </div>
                )}

                {/* Job Retrying Card (Exponential Backoff) */}
                {job?.status === 'retrying' && (
                  <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-800/50 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-amber-300 font-semibold">
                        <Clock className="h-4 w-4 text-amber-400 animate-pulse" />
                        <span>Chờ thử lại (Backoff Delay)</span>
                      </div>
                      <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-amber-900/60 text-amber-200 border border-amber-700">
                        Attempt {job.attempt}/{job.max_attempts}
                      </span>
                    </div>
                    <p className="text-[11px] text-amber-200/80">
                      {job.error_message || 'Tác vụ gặp sự cố tạm thời và đang chờ lượt thử lại tiếp theo.'}
                    </p>
                    {job.error_taxonomy && (
                      <div className="text-[10px] font-mono text-amber-400">
                        Taxonomy: {job.error_taxonomy}
                      </div>
                    )}
                    <button
                      onClick={() => handleRetryJob(false)}
                      disabled={processingAction}
                      className="w-full py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-medium transition flex items-center justify-center gap-1.5 shadow"
                    >
                      <RefreshCw className={`h-3 w-3 ${processingAction ? 'animate-spin' : ''}`} />
                      <span>{processingAction ? 'Đang yêu cầu...' : 'Bỏ qua Backoff & Thử lại ngay'}</span>
                    </button>
                  </div>
                )}

                {/* Job Dead Letter Queue (DLQ) Card */}
                {job?.status === 'dead_letter' && (
                  <div className="p-3 rounded-lg bg-red-950/50 border border-red-800/60 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-red-300 font-semibold">
                        <AlertCircle className="h-4 w-4 text-red-400" />
                        <span>Dead Letter Queue (DLQ)</span>
                      </div>
                      <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-red-900/60 text-red-200 border border-red-700">
                        {job.error_taxonomy || 'UNRECOVERABLE'}
                      </span>
                    </div>
                    <p className="text-[11px] text-red-200/90 leading-relaxed">
                      {job.error_message || 'Tác vụ đã thất bại vĩnh viễn hoặc vượt quá số lần thử lại tối đa.'}
                    </p>
                    <button
                      onClick={() => handleRetryJob(true)}
                      disabled={processingAction}
                      className="w-full py-1.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-medium transition flex items-center justify-center gap-1.5 shadow"
                    >
                      <RefreshCw className={`h-3 w-3 ${processingAction ? 'animate-spin' : ''}`} />
                      <span>{processingAction ? 'Đang yêu cầu...' : 'Hồi sinh Job từ DLQ (Reset về Lần 1)'}</span>
                    </button>
                  </div>
                )}

                {/* Job Standard Failed Card */}
                {(job?.status === 'failed' || (asset.processing_status === 'failed' && job?.status !== 'dead_letter' && job?.status !== 'retrying')) && (
                  <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800/50 space-y-2 text-xs">
                    <div className="flex items-center gap-2 text-rose-300 font-semibold">
                      <AlertCircle className="h-4 w-4 text-rose-400" />
                      <span>Xử lý video thất bại</span>
                    </div>
                    <p className="text-[11px] text-rose-200/80">
                      {job?.error_message || 'Video worker transcoding pipeline failure'}
                    </p>
                    <button
                      onClick={() => handleRetryJob(false)}
                      disabled={processingAction}
                      className="w-full py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-medium transition flex items-center justify-center gap-1.5 shadow"
                    >
                      <RefreshCw className={`h-3 w-3 ${processingAction ? 'animate-spin' : ''}`} />
                      <span>{processingAction ? 'Đang yêu cầu...' : 'Thử lại Transcode (Retry Job)'}</span>
                    </button>
                  </div>
                )}

                {/* Stream URLs */}
                <div className="space-y-2.5">
                  <div>
                    <label className="text-xs text-slate-400 font-medium block mb-1">
                      Master Playlist (.m3u8):
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={`/api/v1/delivery/video/${asset.id}/master.m3u8`}
                        className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-mono text-violet-300"
                      />
                      <button
                        onClick={() => copyText(`/api/v1/delivery/video/${asset.id}/master.m3u8`, true)}
                        className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        <span>Copy</span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-slate-400 font-medium block mb-1">
                      Animated Preview 3s (Hover Trailer):
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={`/api/v1/delivery/video/${asset.id}/trailer.webp`}
                        className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-mono text-violet-300"
                      />
                      <button
                        onClick={() => copyText(`/api/v1/delivery/video/${asset.id}/trailer.webp`, true)}
                        className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        <span>Copy</span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-slate-400 font-medium block mb-1">
                      Poster Frame (WebP):
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={`/api/v1/delivery/video/${asset.id}/poster.webp`}
                        className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-mono text-violet-300"
                      />
                      <button
                        onClick={() => copyText(`/api/v1/delivery/video/${asset.id}/poster.webp`, true)}
                        className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        <span>Copy</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Dynamic Quality Profiles Grid (Non-upscaling) */}
                <div className="pt-2 border-t border-slate-800">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      Adaptive Streaming Profiles
                    </span>
                    <span className="text-[10px] text-violet-400 font-mono">No Upscaling Enforced</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {((!asset.height || asset.height >= 1080) &&
                      (!job?.metadata_json?.output_manifest?.target_profiles ||
                        job.metadata_json.output_manifest.target_profiles.includes('1080p'))) && (
                      <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                        <div className="font-semibold text-slate-200">1080p (Full HD)</div>
                        <div className="text-[11px] text-slate-400">4,500 kbps • 1920×1080</div>
                      </div>
                    )}
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="font-semibold text-slate-200">720p (HD)</div>
                      <div className="text-[11px] text-slate-400">2,500 kbps • 1280×720</div>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="font-semibold text-slate-200">480p (SD)</div>
                      <div className="text-[11px] text-slate-400">1,000 kbps • 854×480</div>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <div className="font-semibold text-slate-200">360p (Mobile Low)</div>
                      <div className="text-[11px] text-slate-400">600 kbps • 640×360</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center bg-slate-950/40 rounded-xl border border-slate-800">
                <Sparkles className="h-8 w-8 text-slate-500 mx-auto mb-2" />
                <h4 className="text-sm font-medium text-slate-200">Visual Studio không khả dụng</h4>
                <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                  Tính năng chỉnh tâm điểm tiêu cự (Focal Point), trích xuất màu Palette và phân phối HLS hiện hỗ trợ cho file Hình ảnh và Video.
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'usage' && (
          <div className="space-y-3">
            {references.length > 0 ? (
              <>
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-start gap-2.5">
                  <ShieldAlert className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold block">Safe Delete Active</span>
                    This asset is registered in {references.length} external applications. Direct deletion is locked to prevent broken images.
                  </div>
                </div>

                <div className="space-y-2">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                    Active Consumer References
                  </span>
                  {references.map((ref) => (
                    <div
                      key={ref.id}
                      className="p-3 rounded-lg bg-slate-950/80 border border-slate-800 flex items-center justify-between"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-violet-600/20 text-violet-300 border border-violet-500/30">
                            {ref.source_app}
                          </span>
                          <span className="text-sm font-medium text-slate-200">{ref.entity_type}</span>
                        </div>
                        <p className="text-xs text-slate-400 font-mono mt-1">
                          ID: {ref.entity_id} {ref.field_name && `• field: ${ref.field_name}`}
                        </p>
                      </div>
                      <ExternalLink className="h-4 w-4 text-slate-400" />
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="p-8 text-center bg-slate-950/40 rounded-xl border border-slate-800/80">
                <Info className="h-8 w-8 text-slate-400 mx-auto mb-2" />
                <h4 className="text-sm font-medium text-slate-200">No External References</h4>
                <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                  This asset is safe to delete or archive because no connected applications are currently using it.
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'storage' && (
          <div className="space-y-3">
            <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Storage Provider</span>
                <span className="text-violet-400 font-mono uppercase">{asset.storage_provider}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800/60">
                <span className="text-slate-400">Bucket</span>
                <span className="text-slate-200 font-mono">{asset.storage_bucket}</span>
              </div>
              <div className="py-1 border-b border-slate-800/60">
                <span className="text-slate-400 block mb-1">Storage Key</span>
                <span className="text-slate-200 font-mono text-[11px] break-all">{asset.storage_key}</span>
              </div>
              {asset.checksum && (
                <div className="py-1">
                  <span className="text-slate-400 block mb-1">SHA-256 Checksum</span>
                  <span className="text-slate-200 font-mono text-[11px] break-all">{asset.checksum}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between gap-3">
        <button
          onClick={() => onTrash(asset.id)}
          className="flex-1 py-2 px-3 rounded-lg border border-slate-700 bg-slate-800 hover:bg-rose-950/40 hover:border-rose-600/50 hover:text-rose-300 text-slate-300 text-sm font-medium flex items-center justify-center gap-2 transition"
        >
          <Trash2 className="h-4 w-4" />
          <span>Move to Trash</span>
        </button>

        <button
          onClick={() => onPurge(asset.id, false)}
          className="py-2 px-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium flex items-center justify-center gap-1.5 transition"
        >
          <span>Safe Purge</span>
        </button>
      </div>
    </div>
  );
}
