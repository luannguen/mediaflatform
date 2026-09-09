'use client';

import { useState } from 'react';
import { useAssets } from '@/hooks/useAssets';
import { useFolders } from '@/hooks/useFolders';
import { AssetCard } from '@/components/media/AssetCard';
import { AssetDetailDrawer } from '@/components/media/AssetDetailDrawer';
import { Asset, AssetType } from '@/types/database';
import {
  LayoutGrid,
  List,
  Filter,
  FolderTree,
  Image as ImageIcon,
  Video,
  FileText,
  Search,
} from 'lucide-react';

export default function LibraryPage() {
  const { assets, total, loading, filters, setFilters, trashAsset, purgeAsset } = useAssets();
  const { folders } = useFolders();
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const handleTypeChange = (type: AssetType | 'all') => {
    setFilters((prev) => ({ ...prev, type }));
  };

  const handleFolderChange = (folderId: string | null) => {
    setFilters((prev) => ({ ...prev, folderId }));
  };

  return (
    <div className="space-y-6">
      {/* Page Title & Count */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight">Media Library</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Showing {assets.length} of {total} assets in current workspace
          </p>
        </div>

        {/* View Switcher */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-md text-xs font-medium transition ${
                viewMode === 'grid' ? 'bg-slate-800 text-violet-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-md text-xs font-medium transition ${
                viewMode === 'list' ? 'bg-slate-800 text-violet-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs">
        {/* Type Badges */}
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {(['all', 'image', 'video', 'document'] as const).map((t) => (
            <button
              key={t}
              onClick={() => handleTypeChange(t)}
              className={`px-3 py-1.5 rounded-lg font-medium capitalize transition flex items-center gap-1.5 ${
                (filters.type || 'all') === t
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              {t === 'image' && <ImageIcon className="h-3.5 w-3.5" />}
              {t === 'video' && <Video className="h-3.5 w-3.5" />}
              {t === 'document' && <FileText className="h-3.5 w-3.5" />}
              <span>{t}</span>
            </button>
          ))}
        </div>

        {/* Folder Select */}
        <div className="flex items-center gap-2">
          <FolderTree className="h-4 w-4 text-slate-400" />
          <select
            value={filters.folderId || ''}
            onChange={(e) => handleFolderChange(e.target.value || null)}
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
      </div>

      {/* Main Asset Grid / List */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="aspect-square bg-slate-900 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : assets.length > 0 ? (
        <div
          className={
            viewMode === 'grid'
              ? 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4'
              : 'space-y-2'
          }
        >
          {assets.map((asset) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              onClick={setSelectedAsset}
              onTrash={trashAsset}
            />
          ))}
        </div>
      ) : (
        <div className="p-16 text-center bg-slate-900/40 border border-slate-800 rounded-2xl">
          <ImageIcon className="h-12 w-12 text-slate-400 mx-auto mb-3" />
          <h3 className="text-base font-medium text-slate-200">No media assets in this view</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            Try adjusting your search query, folder filter, or upload a new media file into this workspace.
          </p>
        </div>
      )}

      {/* Drawer */}
      <AssetDetailDrawer
        asset={selectedAsset}
        onClose={() => setSelectedAsset(null)}
        onTrash={trashAsset}
        onPurge={purgeAsset}
      />
    </div>
  );
}
