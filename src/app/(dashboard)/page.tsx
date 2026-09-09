'use client';

import { useAssets } from '@/hooks/useAssets';
import { useDeveloper } from '@/hooks/useDeveloper';
import {
  HardDrive,
  Image as ImageIcon,
  KeyRound,
  ShieldCheck,
  ArrowUpRight,
  TrendingUp,
  FileCheck2,
  FolderTree,
} from 'lucide-react';
import Link from 'next/link';
import { AssetCard } from '@/components/media/AssetCard';
import { AssetDetailDrawer } from '@/components/media/AssetDetailDrawer';
import { useState } from 'react';
import { Asset } from '@/types/database';

export default function DashboardOverviewPage() {
  const { assets, total, loading, trashAsset, purgeAsset } = useAssets({ limit: 6 });
  const { apiKeys, applications } = useDeveloper();
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);

  const totalBytes = assets.reduce((acc, a) => acc + (a.size_bytes || 0), 0);
  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-8">
      {/* Top Welcome Banner */}
      <div className="bg-gradient-to-r from-violet-900/40 via-purple-900/20 to-slate-900 border border-violet-500/20 rounded-2xl p-6 relative overflow-hidden">
        <div className="max-w-2xl relative z-10">
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-violet-600/30 text-violet-300 border border-violet-500/30 mb-3 inline-block">
            Production Media Workspace
          </span>
          <h1 className="text-2xl font-bold text-slate-100 tracking-tight">
            Centralized Digital Asset Management
          </h1>
          <p className="text-sm text-slate-300 mt-1.5 leading-relaxed">
            Independent media backbone for E-Commerce, Community, and CMS apps. Media is referenced by universal ID (`med_...`) with full usage tracking and safe delete protection.
          </p>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-slate-400">Total Media Assets</span>
            <h3 className="text-2xl font-bold text-slate-100 mt-1">{total}</h3>
            <span className="text-xs text-emerald-400 flex items-center gap-1 mt-1">
              <TrendingUp className="h-3 w-3" /> Active & Verified
            </span>
          </div>
          <div className="p-3 rounded-xl bg-violet-600/10 text-violet-400">
            <ImageIcon className="h-6 w-6" />
          </div>
        </div>

        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-slate-400">Storage Used</span>
            <h3 className="text-2xl font-bold text-slate-100 mt-1">{formatSize(totalBytes)}</h3>
            <span className="text-xs text-slate-400 mt-1 block">Quota: 10 GB (Supabase)</span>
          </div>
          <div className="p-3 rounded-xl bg-emerald-600/10 text-emerald-400">
            <HardDrive className="h-6 w-6" />
          </div>
        </div>

        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-slate-400">Active API Keys</span>
            <h3 className="text-2xl font-bold text-slate-100 mt-1">{apiKeys.filter((k) => k.status === 'active').length}</h3>
            <span className="text-xs text-violet-400 mt-1 block">SHA-256 Encrypted</span>
          </div>
          <div className="p-3 rounded-xl bg-purple-600/10 text-purple-400">
            <KeyRound className="h-6 w-6" />
          </div>
        </div>

        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-slate-400">Connected Apps</span>
            <h3 className="text-2xl font-bold text-slate-100 mt-1">{applications.length}</h3>
            <span className="text-xs text-emerald-400 mt-1 block">Safe Delete Protected</span>
          </div>
          <div className="p-3 rounded-xl bg-blue-600/10 text-blue-400">
            <ShieldCheck className="h-6 w-6" />
          </div>
        </div>
      </div>

      {/* Recent Assets Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Recent Media Assets</h2>
            <p className="text-xs text-slate-400">Latest media ingested across connected applications</p>
          </div>
          <Link
            href="/library"
            className="flex items-center gap-1.5 text-xs font-medium text-violet-400 hover:text-violet-300 transition"
          >
            <span>View all in Library</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="aspect-video bg-slate-900 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : assets.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
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
          <div className="p-12 text-center bg-slate-900/50 border border-slate-800 rounded-2xl">
            <ImageIcon className="h-10 w-10 text-slate-400 mx-auto mb-2" />
            <h4 className="text-sm font-medium text-slate-200">No media assets found</h4>
            <p className="text-xs text-slate-400 mt-1">Upload your first image, video, or document to start.</p>
          </div>
        )}
      </div>

      <AssetDetailDrawer
        asset={selectedAsset}
        onClose={() => setSelectedAsset(null)}
        onTrash={trashAsset}
        onPurge={purgeAsset}
      />
    </div>
  );
}
