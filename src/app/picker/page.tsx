'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  HardDrive,
  Search,
  Check,
  Upload,
  Image as ImageIcon,
  Film,
  FileText,
  Boxes,
  Sparkles,
} from 'lucide-react';
import { Asset } from '@/types/database';
import { toast } from 'sonner';

function MediaPickerContent() {
  const searchParams = useSearchParams();
  const apiKey = searchParams.get('api_key') || '';
  const mode = searchParams.get('mode') || 'single'; // 'single' | 'multiple'
  const filterType = searchParams.get('type') || 'all';

  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedAssets, setSelectedAssets] = useState<Asset[]>([]);
  const [uploading, setUploading] = useState(false);

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      const headers: Record<string, string> = {};
      if (apiKey) {
        headers['X-Media-Api-Key'] = apiKey;
      }

      const query = new URLSearchParams();
      if (search) query.set('search', search);
      if (filterType !== 'all') query.set('type', filterType);
      query.set('limit', '40');

      const res = await fetch(`/api/v1/assets?${query.toString()}`, { headers });
      if (res.ok) {
        const json = await res.json();
        setAssets(json.data || []);
      }
    } catch {
      toast.error('Failed to load media assets');
    } finally {
      setLoading(false);
    }
  }, [apiKey, search, filterType]);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  const toggleSelect = (asset: Asset) => {
    if (mode === 'single') {
      setSelectedAssets([asset]);
    } else {
      if (selectedAssets.some((a) => a.id === asset.id)) {
        setSelectedAssets(selectedAssets.filter((a) => a.id !== asset.id));
      } else {
        setSelectedAssets([...selectedAssets, asset]);
      }
    }
  };

  const handleConfirmSelect = () => {
    if (selectedAssets.length === 0) return;

    const payload = {
      type: 'MEDIA_ASSET_SELECTED',
      asset: mode === 'single' ? selectedAssets[0] : selectedAssets,
    };

    // 1. If inside an iframe, send to parent window
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(payload, '*');
    }

    // 2. If inside a popup window, send to opener
    if (window.opener) {
      window.opener.postMessage(payload, '*');
      window.close();
    }

    toast.success('Media asset selected');
  };

  const handleDirectUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers['X-Media-Api-Key'] = apiKey;

      const sessionRes = await fetch('/api/v1/uploads', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          original_filename: file.name,
          mime_type: file.type || 'application/octet-stream',
          size_bytes: file.size,
          display_name: file.name,
          visibility: 'public',
        }),
      });

      const sessionData = await sessionRes.json();
      if (!sessionRes.ok) throw new Error(sessionData.error?.message || 'Upload failed');

      toast.success(`Uploaded ${file.name}`);
      await fetchAssets();

      if (sessionData.data?.asset) {
        toggleSelect(sessionData.data.asset);
      }
    } catch (err: any) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Navbar */}
      <header className="h-16 border-b border-slate-800 bg-slate-900/90 px-4 sm:px-6 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-violet-600 flex items-center justify-center text-white font-bold shadow-md shadow-violet-600/30">
            <HardDrive className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-tight">Media Library Picker</h1>
            <p className="text-[10px] text-slate-400">Headless Embeddable Widget</p>
          </div>
        </div>

        {/* Center Search */}
        <div className="flex-1 max-w-sm mx-4">
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search assets..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500 min-h-[44px]"
            />
          </div>
        </div>

        {/* Quick Upload Button */}
        <div>
          <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 cursor-pointer transition min-h-[44px]">
            <Upload className="h-3.5 w-3.5 text-violet-400" />
            <span>{uploading ? 'Uploading...' : 'Upload New'}</span>
            <input
              type="file"
              onChange={handleDirectUpload}
              disabled={uploading}
              className="hidden"
            />
          </label>
        </div>
      </header>

      {/* Media Grid */}
      <main className="flex-1 p-4 sm:p-6 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-xs text-slate-400">
            Loading media assets...
          </div>
        ) : assets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center text-slate-400">
            <Boxes className="h-10 w-10 text-slate-600 mb-2" />
            <p className="text-sm font-medium text-slate-300">No media assets found</p>
            <p className="text-xs text-slate-500 mt-1">Upload a file above to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {assets.map((asset) => {
              const isSelected = selectedAssets.some((a) => a.id === asset.id);
              return (
                <div
                  key={asset.id}
                  onClick={() => toggleSelect(asset)}
                  className={`group relative rounded-xl border overflow-hidden cursor-pointer transition bg-slate-900/80 flex flex-col ${
                    isSelected
                      ? 'border-violet-500 ring-2 ring-violet-500/30'
                      : 'border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {/* Thumbnail */}
                  <div className="aspect-square bg-slate-950 flex items-center justify-center relative overflow-hidden">
                    {asset.asset_type === 'image' && asset.storage_url ? (
                      <img
                        src={asset.storage_url}
                        alt={asset.display_name}
                        className="w-full h-full object-cover group-hover:scale-105 transition duration-200"
                        loading="lazy"
                      />
                    ) : asset.asset_type === 'video' ? (
                      <Film className="h-8 w-8 text-slate-500" />
                    ) : (
                      <FileText className="h-8 w-8 text-slate-500" />
                    )}

                    {/* Checkmark overlay */}
                    {isSelected && (
                      <div className="absolute top-2 right-2 h-6 w-6 rounded-full bg-violet-600 text-white flex items-center justify-center shadow-lg">
                        <Check className="h-3.5 w-3.5" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-2 text-left">
                    <p className="text-xs font-medium text-slate-200 truncate">
                      {asset.display_name || asset.original_filename}
                    </p>
                    <div className="flex items-center justify-between text-[10px] text-slate-500 mt-0.5">
                      <span className="uppercase">{asset.extension}</span>
                      <span>{formatBytes(asset.size_bytes)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Bottom Sticky Action Bar */}
      <footer className="h-16 border-t border-slate-800 bg-slate-900/95 backdrop-blur px-4 sm:px-6 flex items-center justify-between sticky bottom-0 z-20">
        <div className="text-xs text-slate-400">
          {selectedAssets.length > 0 ? (
            <span className="text-violet-300 font-medium">
              {selectedAssets.length} asset{selectedAssets.length > 1 ? 's' : ''} selected
            </span>
          ) : (
            <span>Click any media item to select</span>
          )}
        </div>

        <button
          type="button"
          disabled={selectedAssets.length === 0}
          onClick={handleConfirmSelect}
          className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-lg shadow-violet-600/20 transition disabled:opacity-40 min-h-[44px]"
        >
          <Sparkles className="h-4 w-4" />
          <span>Insert Selected Media</span>
        </button>
      </footer>
    </div>
  );
}

export default function MediaPickerPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950 flex items-center justify-center text-xs text-slate-400">Loading Media Picker...</div>}>
      <MediaPickerContent />
    </Suspense>
  );
}
