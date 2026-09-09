'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Asset } from '@/types/database';

export interface UploadProgressItem {
  filename: string;
  progress: number;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  error?: string;
  asset?: Asset;
}

export function useUpload(onSuccess?: (asset: Asset) => void) {
  const [uploading, setUploading] = useState(false);
  const [items, setItems] = useState<UploadProgressItem[]>([]);

  const uploadFiles = async (files: File[], folderId?: string | null) => {
    if (!files || files.length === 0) return;

    setUploading(true);
    const initialItems: UploadProgressItem[] = files.map((f) => ({
      filename: f.name,
      progress: 10,
      status: 'uploading',
    }));
    setItems(initialItems);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const formData = new FormData();
      formData.append('file', file);
      if (folderId) formData.append('folder_id', folderId);

      try {
        const res = await fetch('/api/v1/uploads', {
          method: 'POST',
          body: formData,
        });

        const json = await res.json();
        if (!res.ok) throw new Error(json.error?.message || 'Upload failed');

        const createdAsset = json.data as Asset;
        setItems((prev) =>
          prev.map((item, idx) =>
            idx === i ? { ...item, progress: 100, status: 'completed', asset: createdAsset } : item
          )
        );

        toast.success(`Uploaded: ${file.name}`);
        if (onSuccess) onSuccess(createdAsset);
      } catch (err: any) {
        setItems((prev) =>
          prev.map((item, idx) =>
            idx === i ? { ...item, progress: 0, status: 'failed', error: err.message } : item
          )
        );
        toast.error(`Failed to upload ${file.name}: ${err.message}`);
      }
    }

    setUploading(false);
  };

  const clearQueue = () => setItems([]);

  return {
    uploading,
    items,
    uploadFiles,
    clearQueue,
  };
}
