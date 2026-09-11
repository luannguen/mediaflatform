'use client';

import { useState } from 'react';
import { useCollections } from '@/hooks/useCollections';
import { Boxes, Plus, FolderHeart, ArrowRight, Trash2, Layers } from 'lucide-react';
import Link from 'next/link';

export default function CollectionsPage() {
  const { collections, loading, createCollection, deleteCollection } = useCollections();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setCreating(true);
    const res = await createCollection(name.trim(), description.trim() || undefined);
    if (res) {
      setName('');
      setDescription('');
    }
    setCreating(false);
  };

  const handleDelete = async (e: React.MouseEvent, id: string, colName: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`Are you sure you want to delete collection "${colName}"?`)) return;

    setDeletingId(id);
    await deleteCollection(id);
    setDeletingId(null);
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight">Curated Collections</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Group media assets across multiple folders for marketing campaigns, product releases, or lookbooks
          </p>
        </div>
      </div>

      {/* New Collection Form */}
      <form
        onSubmit={handleCreate}
        className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center gap-3"
      >
        <div className="flex items-center gap-2 flex-1">
          <Boxes className="h-5 w-5 text-violet-400 flex-shrink-0" />
          <input
            type="text"
            placeholder="Collection name (e.g. Summer Lookbook 2026, Hero Banners)..."
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-violet-500"
          />
        </div>
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition disabled:opacity-50 flex-shrink-0 shadow-sm"
        >
          <Plus className="h-4 w-4" />
          <span>{creating ? 'Creating...' : 'Create Collection'}</span>
        </button>
      </form>

      {/* Collections Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-slate-900 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : collections.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {collections.map((col) => (
            <Link
              key={col.id}
              href={`/library?collection_id=${col.id}`}
              className="group p-5 rounded-xl bg-slate-900 border border-slate-800 hover:border-violet-500/60 hover:bg-slate-900/80 hover:shadow-lg hover:shadow-violet-950/20 transition-all flex flex-col justify-between cursor-pointer"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="p-2.5 rounded-lg bg-violet-600/10 text-violet-400 group-hover:bg-violet-600/20 group-hover:text-violet-300 transition-colors flex-shrink-0">
                      <FolderHeart className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-slate-200 group-hover:text-white truncate transition-colors">
                        {col.name}
                      </h3>
                      <span className="text-xs font-mono text-slate-400 block mt-0.5">{col.id}</span>
                    </div>
                  </div>

                  <button
                    onClick={(e) => handleDelete(e, col.id, col.name)}
                    disabled={deletingId === col.id}
                    title="Delete collection"
                    className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 transition opacity-0 group-hover:opacity-100 flex-shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {col.description && (
                  <p className="text-xs text-slate-400 line-clamp-2">{col.description}</p>
                )}
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-violet-400" />
                  <span>{col.asset_count || 0} media assets</span>
                </span>
                <span className="text-violet-400 group-hover:text-violet-300 flex items-center gap-1 font-medium transition-colors">
                  <span>Open Collection</span>
                  <ArrowRight className="h-3 w-3 group-hover:translate-x-1 transition-transform" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="p-16 text-center bg-slate-900/40 border border-slate-800 rounded-2xl">
          <Boxes className="h-12 w-12 text-slate-400 mx-auto mb-3" />
          <h3 className="text-base font-medium text-slate-200">No Collections Created</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            Collections let you bundle assets across different folders for campaigns or projects. Use the form above to create your first collection.
          </p>
        </div>
      )}
    </div>
  );
}
