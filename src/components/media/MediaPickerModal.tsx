'use client';

import { useState } from 'react';
import { useAssets } from '@/hooks/useAssets';
import { useFolders } from '@/hooks/useFolders';
import { Asset, AssetType } from '@/types/database';
import { X, Search, Check, FileText, Image as ImageIcon, Video } from 'lucide-react';

interface MediaPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (asset: Asset) => void;
  allowedTypes?: AssetType[];
}

export function MediaPickerModal({ isOpen, onClose, onSelect, allowedTypes }: MediaPickerModalProps) {
  const { assets, loading, filters, setFilters } = useAssets({ limit: 18 });
  const { folders } = useFolders();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleConfirm = () => {
    const asset = assets.find((a) => a.id === selectedId);
    if (asset) {
      onSelect(asset);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-100">Media Asset Picker</h3>
            <p className="text-xs text-slate-400">Select an existing media asset from your workspace</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="p-3.5 border-b border-slate-800 bg-slate-950/40 flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by name or med_ ID..."
              value={filters.search || ''}
              onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-violet-500"
            />
          </div>

          <select
            value={filters.folderId || ''}
            onChange={(e) => setFilters((prev) => ({ ...prev, folderId: e.target.value || null }))}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-violet-500"
          >
            <option value="">All Folders</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                📁 {f.name}
              </option>
            ))}
          </select>
        </div>

        {/* Grid */}
        <div className="p-4 overflow-y-auto flex-1">
          {loading ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="aspect-square bg-slate-800/50 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : assets.length > 0 ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
              {assets.map((asset) => {
                const isSelected = selectedId === asset.id;
                return (
                  <div
                    key={asset.id}
                    onClick={() => setSelectedId(asset.id)}
                    className={`group relative aspect-square rounded-xl overflow-hidden border cursor-pointer transition ${
                      isSelected
                        ? 'border-violet-500 ring-2 ring-violet-500'
                        : 'border-slate-800 hover:border-slate-700 bg-slate-950'
                    }`}
                  >
                    {asset.asset_type === 'image' && asset.storage_url ? (
                      <img src={asset.storage_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-slate-400">
                        <FileText className="h-8 w-8" />
                      </div>
                    )}

                    {isSelected && (
                      <div className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full bg-violet-600 text-white flex items-center justify-center shadow">
                        <Check className="h-3 w-3" />
                      </div>
                    )}

                    <div className="absolute inset-x-0 bottom-0 p-1.5 bg-slate-950/80 backdrop-blur text-[10px] text-slate-200 truncate">
                      {asset.display_name}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-12 text-center text-slate-400 text-xs">No media assets found</div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3.5 border-t border-slate-800 bg-slate-950/50 flex items-center justify-between">
          <span className="text-xs text-slate-400 font-mono">
            {selectedId ? `Selected: ${selectedId}` : 'Choose an asset'}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg border border-slate-700 text-xs font-medium text-slate-300 hover:bg-slate-800 transition"
            >
              Cancel
            </button>
            <button
              disabled={!selectedId}
              onClick={handleConfirm}
              className="px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-xs font-medium text-white transition disabled:opacity-50"
            >
              Select Asset
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
