'use client';

import { useState, useEffect, useCallback } from 'react';
import { Asset, AssetType } from '@/types/database';
import { toast } from 'sonner';

export interface UseAssetsFilters {
  folderId?: string | null;
  collectionId?: string | null;
  type?: AssetType | 'all';
  search?: string;
  status?: string;
  page?: number;
  limit?: number;
}

export function useAssets(initialFilters: UseAssetsFilters = {}) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<UseAssetsFilters>(initialFilters);

  const fetchAssets = useCallback(async (overrides: Partial<UseAssetsFilters> = {}) => {
    const current = { ...filters, ...overrides };
    setLoading(true);

    try {
      const params = new URLSearchParams();
      if (current.folderId) params.set('folder_id', current.folderId);
      if (current.collectionId) params.set('collection_id', current.collectionId);
      if (current.type && current.type !== 'all') params.set('type', current.type);
      if (current.status) params.set('status', current.status);
      if (current.search) params.set('search', current.search);
      if (current.page) params.set('page', current.page.toString());
      if (current.limit) params.set('limit', current.limit.toString());

      const res = await fetch(`/api/v1/assets?${params.toString()}`);
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error?.message || 'Failed to fetch assets');
      }

      setAssets(json.data || []);
      setTotal(json.meta?.pagination?.total || 0);
    } catch (err: any) {
      toast.error(err.message || 'Error loading assets');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  const trashAsset = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/assets/${id}?action=trash`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || 'Failed to move to trash');

      toast.success('Asset moved to trash');
      setAssets((prev) => prev.filter((a) => a.id !== id));
      setTotal((prev) => Math.max(0, prev - 1));
      return true;
    } catch (err: any) {
      toast.error(err.message);
      return false;
    }
  };

  const restoreAsset = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/assets/${id}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || 'Failed to restore asset');

      toast.success('Asset restored from trash');
      setAssets((prev) => prev.filter((a) => a.id !== id));
      return true;
    } catch (err: any) {
      toast.error(err.message);
      return false;
    }
  };

  const purgeAsset = async (id: string, force: boolean = false) => {
    try {
      const res = await fetch(`/api/v1/assets/${id}?action=purge&force=${force}`, { method: 'DELETE' });
      const json = await res.json();

      if (!res.ok) {
        if (json.error?.code === 'ASSET_IN_USE') {
          const refs = json.error?.details?.references?.length || 0;
          throw new Error(
            `Safe Delete Blocked: Asset is in use by ${refs} external places. Check Usage tab first!`
          );
        }
        throw new Error(json.error?.message || 'Failed to permanently delete asset');
      }

      toast.success('Asset permanently deleted');
      setAssets((prev) => prev.filter((a) => a.id !== id));
      setTotal((prev) => Math.max(0, prev - 1));
      return true;
    } catch (err: any) {
      toast.error(err.message);
      return false;
    }
  };

  return {
    assets,
    loading,
    total,
    filters,
    setFilters,
    fetchAssets,
    trashAsset,
    restoreAsset,
    purgeAsset,
  };
}
