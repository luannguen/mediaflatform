'use client';

import { Asset } from '@/types/database';
import { FileText, Video, Music, Copy, Trash2, Check, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

interface AssetCardProps {
  asset: Asset;
  onClick: (asset: Asset) => void;
  onTrash: (id: string) => void;
}

export function AssetCard({ asset, onClick, onTrash }: AssetCardProps) {
  const [copied, setCopied] = useState(false);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const copyId = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(asset.id);
    setCopied(true);
    toast.success(`Copied Asset ID: ${asset.id}`);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleTrash = (e: React.MouseEvent) => {
    e.stopPropagation();
    onTrash(asset.id);
  };

  return (
    <div
      onClick={() => onClick(asset)}
      className="group relative bg-slate-900 border border-slate-800 hover:border-violet-500/50 rounded-xl overflow-hidden cursor-pointer transition-all hover:shadow-xl hover:shadow-violet-950/20 flex flex-col"
    >
      {/* Thumbnail Area */}
      <div className="aspect-video w-full bg-slate-950 relative overflow-hidden flex items-center justify-center border-b border-slate-800/80">
        {asset.asset_type === 'image' && asset.storage_url ? (
          <img
            src={asset.storage_url}
            alt={asset.display_name}
            className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
            loading="lazy"
          />
        ) : asset.asset_type === 'document' ? (
          <FileText className="h-12 w-12 text-slate-400 group-hover:text-violet-400 transition" />
        ) : asset.asset_type === 'video' ? (
          <Video className="h-12 w-12 text-slate-400 group-hover:text-violet-400 transition" />
        ) : asset.asset_type === 'audio' ? (
          <Music className="h-12 w-12 text-slate-400 group-hover:text-violet-400 transition" />
        ) : (
          <FileText className="h-12 w-12 text-slate-400" />
        )}

        {/* Type Badge */}
        <span className="absolute top-2 left-2 px-2 py-0.5 rounded text-[10px] font-semibold tracking-wider uppercase bg-slate-900/80 backdrop-blur border border-slate-700 text-slate-300">
          {asset.asset_type}
        </span>

        {/* Quick Actions Hover Overlay */}
        <div className="absolute top-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition duration-200">
          <button
            onClick={copyId}
            title="Copy Asset ID"
            className="p-1.5 rounded-lg bg-slate-900/90 hover:bg-violet-600 text-slate-300 hover:text-white border border-slate-700 transition"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={handleTrash}
            title="Move to Trash"
            className="p-1.5 rounded-lg bg-slate-900/90 hover:bg-rose-600 text-slate-300 hover:text-white border border-slate-700 transition"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Meta Area */}
      <div className="p-3.5 flex-1 flex flex-col justify-between">
        <div>
          <h3 className="text-sm font-medium text-slate-200 truncate group-hover:text-violet-300 transition">
            {asset.display_name}
          </h3>
          <p className="text-xs text-slate-400 font-mono mt-0.5 truncate">{asset.id}</p>
        </div>

        <div className="mt-3 pt-2.5 border-t border-slate-800/60 flex items-center justify-between text-xs text-slate-400">
          <span>{formatSize(asset.size_bytes)}</span>
          {asset.width && asset.height && (
            <span className="text-[11px] text-slate-400 font-mono">
              {asset.width}x{asset.height}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
