'use client';

import { useState, useEffect, useCallback } from 'react';
import { Folder } from '@/types/database';
import { toast } from 'sonner';

export function useFolders() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFolders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/folders');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || 'Failed to fetch folders');
      setFolders(json.data || []);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFolders();
  }, [fetchFolders]);

  const createFolder = async (name: string, parentFolderId?: string | null) => {
    try {
      const res = await fetch('/api/v1/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parent_folder_id: parentFolderId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || 'Failed to create folder');
      toast.success(`Folder "${name}" created`);
      setFolders((prev) => [...prev, json.data]);
      return json.data as Folder;
    } catch (err: any) {
      toast.error(err.message);
      return null;
    }
  };

  return {
    folders,
    loading,
    fetchFolders,
    createFolder,
  };
}
