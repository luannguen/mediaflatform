'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAssets } from '@/hooks/useAssets';
import { useFolders } from '@/hooks/useFolders';
import { useCollections } from '@/hooks/useCollections';
import { AssetCard } from '@/components/media/AssetCard';
import { AssetDetailDrawer } from '@/components/media/AssetDetailDrawer';
import { Asset, AssetType } from '@/types/database';
import {
  LayoutGrid,
  List,
  FolderTree,
  Boxes,
  Image as ImageIcon,
  Video,
  FileText,
  X,
} from 'lucide-react';

function LibraryContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const folderIdFromUrl = searchParams.get('folder_id');
  const collectionIdFromUrl = searchParams.get('collection_id');

  const { assets, total, loading, filters, setFilters, trashAsset, purgeAsset } = useAssets({
    folderId: folderIdFromUrl || null,
    collectionId: collectionIdFromUrl || null,
  });
  const { folders } = useFolders();
  const { collections } = useCollections();
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Keep filters in sync with URL query params
  useEffect(() => {
    const fId = folderIdFromUrl || null;
    const cId = collectionIdFromUrl || null;
    if (fId !== (filters.folderId || null) || cId !== (filters.collectionId || null)) {
      setFilters((prev) => ({
        ...prev,
        folderId: fId,
        collectionId: cId,
      }));
    }
  }, [folderIdFromUrl, collectionIdFromUrl, filters.folderId, filters.collectionId, setFilters]);

  const handleTypeChange = (type: AssetType | 'all') => {
    setFilters((prev) => ({ ...prev, type }));
  };

  const handleFolderChange = (folderId: string | null) => {
    setFilters((prev) => ({ ...prev, folderId }));
    const params = new URLSearchParams(searchParams.toString());
    if (folderId) {
      params.set('folder_id', folderId);
    } else {
      params.delete('folder_id');
    }
    const query = params.toString();
    router.replace(query ? `/library?${query}` : '/library');
  };

  const handleCollectionChange = (collectionId: string | null) => {
    setFilters((prev) => ({ ...prev, collectionId }));
    const params = new URLSearchParams(searchParams.toString());
    if (collectionId) {
      params.set('collection_id', collectionId);
    } else {
      params.delete('collection_id');
    }
    const query = params.toString();
    router.replace(query ? `/library?${query}` : '/library');
  };

  const activeFolder = folders.find((f) => f.id === filters.folderId);
  const activeCollection = collections.find((c) => c.id === filters.collectionId);

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
              title="Grid View"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-md text-xs font-medium transition ${
                viewMode === 'list' ? 'bg-slate-800 text-violet-400' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="List View"
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
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
              }`}
            >
              {t === 'image' && <ImageIcon className="h-3.5 w-3.5" />}
              {t === 'video' && <Video className="h-3.5 w-3.5" />}
              {t === 'document' && <FileText className="h-3.5 w-3.5" />}
              <span>{t}</span>
            </button>
          ))}
        </div>

        {/* Folder & Collection Dropdowns */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Folder Select */}
          <div className="flex items-center gap-1.5">
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

          {/* Collection Select */}
          <div className="flex items-center gap-1.5">
            <Boxes className="h-4 w-4 text-violet-400" />
            <select
              value={filters.collectionId || ''}
              onChange={(e) => handleCollectionChange(e.target.value || null)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-violet-500"
            >
              <option value="">All Collections</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  🗂️ {c.name} ({c.asset_count || 0})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Active Folder Filter Banner */}
      {filters.folderId && (
        <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-violet-950/40 border border-violet-800/40 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <span className="p-1 rounded bg-violet-600/20 text-violet-300 flex-shrink-0">
              <FolderTree className="h-3.5 w-3.5" />
            </span>
            <span className="text-slate-400 truncate">
              Viewing folder:{' '}
              <strong className="text-violet-200 font-semibold">{activeFolder?.name || filters.folderId}</strong>
            </span>
            <span className="text-slate-500 font-mono text-[10px] hidden sm:inline">({filters.folderId})</span>
          </div>
          <button
            onClick={() => handleFolderChange(null)}
            className="text-violet-400 hover:text-violet-300 hover:underline flex items-center gap-1 font-medium transition flex-shrink-0 ml-2"
          >
            <X className="h-3 w-3" />
            <span>Show All Assets</span>
          </button>
        </div>
      )}

      {/* Active Collection Filter Banner */}
      {filters.collectionId && (
        <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-purple-950/40 border border-purple-800/40 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <span className="p-1 rounded bg-purple-600/20 text-purple-300 flex-shrink-0">
              <Boxes className="h-3.5 w-3.5" />
            </span>
            <span className="text-slate-400 truncate">
              Viewing collection:{' '}
              <strong className="text-purple-200 font-semibold">{activeCollection?.name || filters.collectionId}</strong>
            </span>
            <span className="text-slate-500 font-mono text-[10px] hidden sm:inline">({filters.collectionId})</span>
          </div>
          <button
            onClick={() => handleCollectionChange(null)}
            className="text-purple-400 hover:text-purple-300 hover:underline flex items-center gap-1 font-medium transition flex-shrink-0 ml-2"
          >
            <X className="h-3 w-3" />
            <span>Show All Assets</span>
          </button>
        </div>
      )}

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
          <ImageIcon className="h-12 w-12 text-slate-500 mx-auto mb-3" />
          <h3 className="text-base font-medium text-slate-200">
            {filters.collectionId
              ? `No media assets in "${activeCollection?.name || 'this collection'}"`
              : filters.folderId
              ? `No media assets in "${activeFolder?.name || 'this folder'}"`
              : 'No media assets in this view'}
          </h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            {filters.collectionId
              ? 'This collection does not contain any assets yet. You can add assets to this collection from the asset detail drawer.'
              : filters.folderId
              ? 'This folder is currently empty. You can upload media into this folder or clear the filter to view all assets.'
              : 'Try adjusting your search query, folder filter, or upload a new media file into this workspace.'}
          </p>
          {(filters.collectionId || filters.folderId) && (
            <div className="mt-4 flex items-center justify-center gap-3">
              <button
                onClick={() => {
                  handleFolderChange(null);
                  handleCollectionChange(null);
                }}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 font-medium transition"
              >
                Show All Assets
              </button>
            </div>
          )}
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

export default function LibraryPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <div className="h-12 bg-slate-900 rounded-xl animate-pulse" />
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="aspect-square bg-slate-900 rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      }
    >
      <LibraryContent />
    </Suspense>
  );
}
