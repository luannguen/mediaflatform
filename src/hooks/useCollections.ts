'use client';

import { useState, useEffect, useCallback } from 'react';
import { CollectionWithCount } from '@/services/collectionService';
import { toast } from 'sonner';

export function useCollections() {
  const [collections, setCollections] = useState<CollectionWithCount[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCollections = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/collections');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || 'Failed to fetch collections');
      setCollections(json.data || []);
    } catch (err: any) {
      toast.error(err.message || 'Error loading collections');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCollections();
  }, [fetchCollections]);

  const createCollection = async (name: string, description?: string) => {
    try {
      const res = await fetch('/api/v1/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || 'Failed to create collection');
      toast.success(`Collection "${name}" created`);
      setCollections((prev) => [...prev, json.data]);
      return json.data as CollectionWithCount;
    } catch (err: any) {
      toast.error(err.message || 'Error creating collection');
      return null;
    }
  };

  const deleteCollection = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/collections/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || 'Failed to delete collection');
      toast.success('Collection deleted');
      setCollections((prev) => prev.filter((c) => c.id !== id));
      return true;
    } catch (err: any) {
      toast.error(err.message || 'Error deleting collection');
      return false;
    }
  };

  const addAssetToCollection = async (collectionId: string, assetId: string) => {
    try {
      const res = await fetch(`/api/v1/collections/${collectionId}/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_id: assetId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || 'Failed to add asset to collection');
      toast.success('Added to collection');
      setCollections((prev) =>
        prev.map((c) => (c.id === collectionId ? { ...c, asset_count: (c.asset_count || 0) + 1 } : c))
      );
      return true;
    } catch (err: any) {
      toast.error(err.message || 'Error adding to collection');
      return false;
    }
  };

  const removeAssetFromCollection = async (collectionId: string, assetId: string) => {
    try {
      const res = await fetch(`/api/v1/collections/${collectionId}/assets/${assetId}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || 'Failed to remove asset from collection');
      toast.success('Removed from collection');
      setCollections((prev) =>
        prev.map((c) =>
          c.id === collectionId ? { ...c, asset_count: Math.max(0, (c.asset_count || 0) - 1) } : c
        )
      );
      return true;
    } catch (err: any) {
      toast.error(err.message || 'Error removing from collection');
      return false;
    }
  };

  return {
    collections,
    loading,
    fetchCollections,
    createCollection,
    deleteCollection,
    addAssetToCollection,
    removeAssetFromCollection,
  };
}
