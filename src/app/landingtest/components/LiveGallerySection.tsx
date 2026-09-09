'use client';

import React, { useEffect, useState } from 'react';
import { Database, Image as ImageIcon, Video, FileText, Search, Copy, Check, ExternalLink, RefreshCw, Eye, Sparkles } from 'lucide-react';
import { DEMO_CREDENTIALS } from './HeroSection';
import { toast } from 'sonner';

interface AssetData {
  id: string;
  display_name: string;
  original_filename: string;
  asset_type: 'image' | 'video' | 'document' | 'audio' | 'archive' | 'other';
  mime_type: string;
  extension?: string;
  size_bytes: number;
  width?: number | null;
  height?: number | null;
  storage_url?: string | null;
  status: string;
  metadata_json?: {
    tags?: string[];
    category?: string;
    alt?: string;
    resolution?: string;
  };
  created_at: string;
}

export function LiveGallerySection() {
  const [assets, setAssets] = useState<AssetData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'image' | 'video' | 'document' | 'vector'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<AssetData | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchAssets = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/assets?limit=all', {
        headers: {
          'X-Media-Api-Key': DEMO_CREDENTIALS.rawKey,
        },
      });

      if (!res.ok) {
        throw new Error(`API trả về lỗi HTTP ${res.status}`);
      }

      const json = await res.json();
      setAssets(json.data || []);
    } catch (err: any) {
      console.error('Fetch assets error:', err);
      setError(err.message || 'Không thể tải media từ API');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAssets();
  }, []);

  const filteredAssets = assets.filter((asset) => {
    // Tab filter
    if (activeTab === 'image' && (asset.asset_type !== 'image' || asset.mime_type === 'image/svg+xml')) return false;
    if (activeTab === 'video' && asset.asset_type !== 'video') return false;
    if (activeTab === 'document' && asset.asset_type !== 'document') return false;
    if (activeTab === 'vector' && asset.mime_type !== 'image/svg+xml') return false;

    // Search filter
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      const matchName = asset.display_name?.toLowerCase().includes(q);
      const matchTags = asset.metadata_json?.tags?.some((t) => t.toLowerCase().includes(q));
      if (!matchName && !matchTags) return false;
    }

    return true;
  });

  const copyDeliveryUrl = (asset: AssetData, e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}/api/v1/delivery/${asset.id}?w=800&format=webp&q=85`;
    navigator.clipboard.writeText(url);
    setCopiedId(asset.id);
    toast.success(`Đã sao chép CDN URL của "${asset.display_name}"!`);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <section id="gallery" className="py-20 border-b border-slate-800/80 bg-slate-950 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-10 gap-4">
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-semibold px-2.5 py-1 rounded-md bg-sky-500/10 text-sky-400 border border-sky-500/20 mb-3">
              <Database className="w-3.5 h-3.5" />
              <span>Real-time REST API Integration</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              Kho Media Trực Tiếp (Live Asset Catalog)
            </h2>
            <p className="mt-2 text-sm sm:text-base text-slate-400 max-w-2xl">
              Toàn bộ dữ liệu dưới đây được lấy trực tiếp qua endpoint <code className="text-sky-300 bg-slate-900 px-1.5 py-0.5 rounded font-mono text-xs">GET /api/v1/assets?limit=all</code> bằng Demo API Key.
            </p>
          </div>

          <button
            onClick={fetchAssets}
            disabled={loading}
            className="self-start md:self-auto flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-xs font-semibold text-slate-300 hover:text-white transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Tải Lại API</span>
          </button>
        </div>

        {/* Filter Controls Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-8 bg-slate-900/60 p-3 rounded-2xl border border-slate-800">
          {/* Category Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
            {[
              { id: 'all', label: 'Tất Cả', icon: Database },
              { id: 'image', label: 'Hình Ảnh', icon: ImageIcon },
              { id: 'video', label: 'Video', icon: Video },
              { id: 'vector', label: 'Vector SVG', icon: Sparkles },
              { id: 'document', label: 'Tài Liệu', icon: FileText },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                    isActive
                      ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/25'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Search Input */}
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Tìm kiếm theo tên, tag..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-sky-500/80 transition-colors"
            />
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="py-24 text-center">
            <RefreshCw className="w-8 h-8 text-sky-400 animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-400 font-mono">Đang gọi API v1 với Demo Key...</p>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="py-16 text-center bg-red-500/10 border border-red-500/20 rounded-2xl p-6">
            <p className="text-red-400 font-semibold mb-2">Lỗi kết nối API:</p>
            <p className="text-xs text-slate-400 font-mono">{error}</p>
            <button
              onClick={fetchAssets}
              className="mt-4 px-4 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-300 text-xs font-semibold cursor-pointer"
            >
              Thử lại
            </button>
          </div>
        )}

        {/* Asset Cards Grid */}
        {!loading && !error && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredAssets.map((asset) => {
              const isImage = asset.asset_type === 'image';
              const isSvg = asset.mime_type === 'image/svg+xml';
              const isVideo = asset.asset_type === 'video';
              const isDoc = asset.asset_type === 'document';
              const deliveryThumb = isImage
                ? isSvg
                  ? asset.storage_url || ''
                  : `/api/v1/delivery/${asset.id}?w=500&format=webp&q=80`
                : null;

              return (
                <div
                  key={asset.id}
                  onClick={() => setSelectedAsset(asset)}
                  className="group bg-slate-900/60 hover:bg-slate-900 border border-slate-800/80 hover:border-sky-500/40 rounded-2xl overflow-hidden shadow-lg transition-all duration-300 flex flex-col cursor-pointer hover:scale-[1.02] hover:shadow-sky-500/10"
                >
                  {/* Thumbnail Container */}
                  <div className="relative aspect-video w-full bg-slate-950 flex items-center justify-center overflow-hidden border-b border-slate-800/60">
                    {isImage && deliveryThumb && (
                      <img
                        src={deliveryThumb}
                        alt={asset.display_name}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    )}

                    {isVideo && (
                      <div className="flex flex-col items-center gap-2 text-purple-400">
                        <div className="w-12 h-12 rounded-full bg-purple-500/20 flex items-center justify-center border border-purple-500/30">
                          <Video className="w-6 h-6" />
                        </div>
                        <span className="text-[11px] font-mono text-slate-400">4K Video Stream</span>
                      </div>
                    )}

                    {isDoc && (
                      <div className="flex flex-col items-center gap-2 text-amber-400">
                        <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center border border-amber-500/30">
                          <FileText className="w-6 h-6" />
                        </div>
                        <span className="text-[11px] font-mono text-slate-400">PDF Document</span>
                      </div>
                    )}

                    {/* Format Badge */}
                    <div className="absolute top-3 left-3 px-2 py-0.5 rounded-md bg-slate-950/80 backdrop-blur-md text-[10px] font-mono font-bold text-slate-300 border border-slate-700/80">
                      {asset.mime_type?.split('/')[1]?.toUpperCase() || 'FILE'}
                    </div>

                    {/* Quick Preview Icon */}
                    <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900/90 text-sky-400 p-1.5 rounded-lg border border-slate-700">
                      <Eye className="w-3.5 h-3.5" />
                    </div>
                  </div>

                  {/* Body Content */}
                  <div className="p-4 flex-1 flex flex-col justify-between">
                    <div>
                      <h3 className="font-semibold text-sm text-slate-200 group-hover:text-sky-300 transition-colors line-clamp-1">
                        {asset.display_name}
                      </h3>
                      <div className="flex items-center gap-3 text-xs text-slate-500 mt-1.5 font-mono">
                        <span>{formatSize(asset.size_bytes)}</span>
                        {asset.width && asset.height && (
                          <>
                            <span>•</span>
                            <span>{asset.width}x{asset.height}</span>
                          </>
                        )}
                      </div>

                      {/* Tags */}
                      {asset.metadata_json?.tags && (
                        <div className="flex flex-wrap gap-1 mt-3">
                          {asset.metadata_json.tags.slice(0, 3).map((tag) => (
                            <span
                              key={tag}
                              className="text-[10px] px-2 py-0.5 rounded bg-slate-800/80 text-slate-400 border border-slate-700/50"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Bottom Action Bar */}
                    <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between">
                      <span className="text-[11px] text-slate-500 font-mono truncate max-w-[140px]">
                        {asset.id}
                      </span>
                      <button
                        onClick={(e) => copyDeliveryUrl(asset, e)}
                        className="flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 hover:underline cursor-pointer"
                        title="Sao chép CDN Delivery URL"
                      >
                        {copiedId === asset.id ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span className="text-emerald-400">Đã chép</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy CDN</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Empty Search Result */}
        {!loading && !error && filteredAssets.length === 0 && (
          <div className="py-20 text-center bg-slate-900/30 rounded-2xl border border-dashed border-slate-800">
            <Database className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-400">Không tìm thấy asset nào phù hợp với bộ lọc hiện tại.</p>
          </div>
        )}

        {/* Modal Inspector */}
        {selectedAsset && (
          <div
            className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4"
            onClick={() => setSelectedAsset(null)}
          >
            <div
              className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                  <h3 className="font-bold text-lg text-white">{selectedAsset.display_name}</h3>
                </div>
                <button
                  onClick={() => setSelectedAsset(null)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 text-sm cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* Preview Image / Player */}
              <div className="my-5 rounded-xl overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center max-h-72">
                {selectedAsset.asset_type === 'image' && (
                  <img
                    src={selectedAsset.storage_url?.startsWith('data:') ? selectedAsset.storage_url : `/api/v1/delivery/${selectedAsset.id}?w=1000&format=webp&q=85`}
                    alt={selectedAsset.display_name}
                    className="max-h-72 w-full object-contain"
                  />
                )}
                {selectedAsset.asset_type === 'video' && selectedAsset.storage_url && (
                  <video src={selectedAsset.storage_url} controls className="w-full max-h-72" />
                )}
                {selectedAsset.asset_type === 'document' && (
                  <div className="p-8 text-center text-amber-400">
                    <FileText className="w-16 h-16 mx-auto mb-2" />
                    <a
                      href={selectedAsset.storage_url || '#'}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs underline text-sky-400 hover:text-sky-300"
                    >
                      Mở tài liệu PDF trong tab mới
                    </a>
                  </div>
                )}
              </div>

              {/* Metadata Details */}
              <div className="grid grid-cols-2 gap-3 text-xs font-mono mb-4">
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <span className="text-slate-500 block">ASSET ID:</span>
                  <span className="text-sky-400 select-all font-semibold">{selectedAsset.id}</span>
                </div>
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <span className="text-slate-500 block">MIME TYPE:</span>
                  <span className="text-slate-200">{selectedAsset.mime_type}</span>
                </div>
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <span className="text-slate-500 block">DUNG LƯỢNG GỐC:</span>
                  <span className="text-slate-200">{formatSize(selectedAsset.size_bytes)}</span>
                </div>
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <span className="text-slate-500 block">ĐỘ PHÂN GIẢI:</span>
                  <span className="text-slate-200">
                    {selectedAsset.width ? `${selectedAsset.width} x ${selectedAsset.height} px` : 'N/A'}
                  </span>
                </div>
              </div>

              {/* CDN Delivery URL */}
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs font-mono mb-6">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-slate-500">DYNAMIC CDN ENDPOINT:</span>
                  <button
                    onClick={(e) => copyDeliveryUrl(selectedAsset, e)}
                    className="text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    <span>Copy URL</span>
                  </button>
                </div>
                <div className="text-emerald-400 select-all break-all">
                  {typeof window !== 'undefined' ? `${window.location.origin}/api/v1/delivery/${selectedAsset.id}?w=800&format=webp&q=85` : ''}
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={() => setSelectedAsset(null)}
                  className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
