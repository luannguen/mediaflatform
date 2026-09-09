'use client';

import { useState, useEffect } from 'react';
import { collectionService } from '@/services/collectionService';
import { Boxes, Plus, FolderHeart } from 'lucide-react';
import { Collection } from '@/types/database';
import { toast } from 'sonner';

export default function CollectionsPage() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchCollections = async () => {
    try {
      const res = await fetch('/api/v1/collections');
      if (res.ok) {
        const json = await res.json();
        setCollections(json.data || []);
      }
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCollections();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setCreating(true);
    try {
      const res = await fetch('/api/v1/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || 'Failed to create collection');

      setCollections((prev) => [...prev, json.data]);
      setName('');
      toast.success(`Collection "${name}" created`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold text-slate-100 tracking-tight">Curated Collections</h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Group media assets across multiple folders for marketing, campaigns, or releases
        </p>
      </div>

      <form
        onSubmit={handleCreate}
        className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-center gap-3"
      >
        <Boxes className="h-5 w-5 text-violet-400 flex-shrink-0" />
        <input
          type="text"
          placeholder="New collection name (e.g. Summer Lookbook, Homepage Hero Slides)..."
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-violet-500"
        />
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          <span>{creating ? 'Creating...' : 'Create Collection'}</span>
        </button>
      </form>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 bg-slate-900 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : collections.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {collections.map((col) => (
            <div key={col.id} className="p-5 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-violet-600/10 text-violet-400">
                  <FolderHeart className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-200">{col.name}</h3>
                  <span className="text-xs font-mono text-slate-400">{col.id}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-16 text-center bg-slate-900/40 border border-slate-800 rounded-2xl">
          <Boxes className="h-10 w-10 text-slate-400 mx-auto mb-2" />
          <h3 className="text-sm font-medium text-slate-200">No Collections Created</h3>
          <p className="text-xs text-slate-400 mt-1">
            Collections let you bundle photos and assets across any folders for specific projects.
          </p>
        </div>
      )}
    </div>
  );
}
