'use client';

import { useState } from 'react';
import { useFolders } from '@/hooks/useFolders';
import { FolderTree, Plus, Folder as FolderIcon, Trash2, ArrowRight } from 'lucide-react';
import Link from 'next/link';

export default function FoldersPage() {
  const { folders, loading, createFolder } = useFolders();
  const [newFolderName, setNewFolderName] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;

    setCreating(true);
    await createFolder(newFolderName.trim());
    setNewFolderName('');
    setCreating(false);
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight">Folder Hierarchy</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Organize assets logically without altering permanent Asset IDs
          </p>
        </div>
      </div>

      {/* New Folder Form */}
      <form
        onSubmit={handleCreate}
        className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-center gap-3"
      >
        <FolderIcon className="h-5 w-5 text-violet-400 flex-shrink-0" />
        <input
          type="text"
          placeholder="New folder name (e.g. Banners, Product Stills, Documents)..."
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-violet-500"
        />
        <button
          type="submit"
          disabled={creating || !newFolderName.trim()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          <span>{creating ? 'Creating...' : 'Create Folder'}</span>
        </button>
      </form>

      {/* Folder Cards List */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-slate-900 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : folders.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {folders.map((f) => (
            <Link
              key={f.id}
              href={`/library?folder_id=${f.id}`}
              className="group p-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-violet-500/60 hover:bg-slate-900/80 hover:shadow-lg hover:shadow-violet-950/20 transition-all flex flex-col justify-between cursor-pointer"
            >
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-lg bg-violet-600/10 text-violet-400 group-hover:bg-violet-600/20 group-hover:text-violet-300 transition-colors">
                  <FolderIcon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-slate-200 group-hover:text-white truncate transition-colors">
                    {f.name}
                  </h3>
                  <span className="text-xs font-mono text-slate-400 block mt-0.5">{f.id}</span>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
                <span className="text-slate-400">
                  {new Date(f.created_at).toLocaleDateString()}
                </span>
                <span className="text-violet-400 group-hover:text-violet-300 flex items-center gap-1 font-medium transition-colors">
                  <span>Open Folder</span>
                  <ArrowRight className="h-3 w-3 group-hover:translate-x-1 transition-transform" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="p-12 text-center bg-slate-900/40 border border-slate-800 rounded-2xl">
          <FolderTree className="h-10 w-10 text-slate-400 mx-auto mb-2" />
          <h3 className="text-sm font-medium text-slate-200">No folders created yet</h3>
          <p className="text-xs text-slate-400 mt-1">Use the form above to create your first folder.</p>
        </div>
      )}
    </div>
  );
}
