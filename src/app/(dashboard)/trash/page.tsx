'use client';

import { useAssets } from '@/hooks/useAssets';
import { Trash2, RotateCcw, ShieldAlert, FileText, AlertTriangle } from 'lucide-react';

export default function TrashPage() {
  const { assets, loading, restoreAsset, purgeAsset } = useAssets({ status: 'trashed' });

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight">Trash Bin & Retention</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Soft-deleted assets held safely during the 30-day retention period
          </p>
        </div>
      </div>

      <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center gap-3 text-xs text-slate-300">
        <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0" />
        <div>
          <span className="font-semibold text-slate-200">Safe Delete Policy Active:</span> Permanent deletion
          is strictly blocked if an asset is referenced by any external applications (Commerce, Community).
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-slate-900 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : assets.length > 0 ? (
        <div className="space-y-3">
          {assets.map((asset) => (
            <div
              key={asset.id}
              className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-4"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-10 w-10 rounded-lg bg-slate-950 flex items-center justify-center text-slate-400 border border-slate-800 flex-shrink-0">
                  {asset.asset_type === 'image' && asset.storage_url ? (
                    <img src={asset.storage_url} alt="" className="h-full w-full object-cover rounded-lg" />
                  ) : (
                    <FileText className="h-5 w-5" />
                  )}
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-medium text-slate-200 truncate">{asset.display_name}</h3>
                  <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5 font-mono">
                    <span>{asset.id}</span>
                    <span>•</span>
                    <span>Deleted: {asset.deleted_at ? new Date(asset.deleted_at).toLocaleDateString() : 'Recently'}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => restoreAsset(asset.id)}
                  className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 text-xs font-medium text-emerald-400 flex items-center gap-1.5 transition"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Restore</span>
                </button>
                <button
                  onClick={() => purgeAsset(asset.id, false)}
                  className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-medium text-white flex items-center gap-1.5 transition"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Purge</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-16 text-center bg-slate-900/40 border border-slate-800 rounded-2xl">
          <Trash2 className="h-10 w-10 text-slate-400 mx-auto mb-2" />
          <h3 className="text-sm font-medium text-slate-200">Trash Bin is Empty</h3>
          <p className="text-xs text-slate-400 mt-1">No trashed assets in this workspace.</p>
        </div>
      )}
    </div>
  );
}
