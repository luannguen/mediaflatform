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

      try {
        // 1. Initialize Direct Upload Session (POST /api/v1/uploads/sessions)
        setItems((prev) =>
          prev.map((item, idx) => (idx === i ? { ...item, progress: 10 } : item))
        );

        const sessionRes = await fetch('/api/v1/uploads/sessions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filename: file.name,
            mime_type: file.type || 'application/octet-stream',
            file_size: file.size,
            file_size_bytes: file.size,
            folder_id: folderId || null,
            visibility: 'workspace',
          }),
        });

        const sessionJson = await sessionRes.json();
        if (!sessionRes.ok) {
          throw new Error(
            sessionJson.error?.message || sessionJson.message || `Failed to initialize upload session (${sessionRes.status})`
          );
        }

        const { session, capability } = sessionJson.data || sessionJson;
        if (!session?.id || !capability?.uploadUrl) {
          throw new Error('Upload session or capability missing in response');
        }

        // 2. Direct Storage Upload via capability with real-time XHR progress
        const uploadHeaders: Record<string, string> = {
          'Content-Type': file.type || 'application/octet-stream',
          ...(capability.headers || {}),
        };

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open(capability.method || 'PUT', capability.uploadUrl, true);

          for (const [k, v] of Object.entries(uploadHeaders)) {
            xhr.setRequestHeader(k, v);
          }

          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              const pct = Math.min(90, Math.round(15 + (event.loaded / event.total) * 75));
              setItems((prev) =>
                prev.map((item, idx) => (idx === i ? { ...item, progress: pct } : item))
              );
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              reject(new Error(`Direct storage upload failed with HTTP status ${xhr.status}`));
            }
          };

          xhr.onerror = () => reject(new Error('Network error during direct storage upload'));
          xhr.send(file);
        });

        // 3. Finalize Upload Session (POST /api/v1/uploads/sessions/:id/complete)
        setItems((prev) =>
          prev.map((item, idx) => (idx === i ? { ...item, progress: 95 } : item))
        );

        const completeRes = await fetch(`/api/v1/uploads/sessions/${session.id}/complete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });

        const completeJson = await completeRes.json();
        if (!completeRes.ok) {
          throw new Error(
            completeJson.error?.message || completeJson.message || `Failed to complete upload session (${completeRes.status})`
          );
        }

        const createdAsset = (completeJson.data?.asset || completeJson.asset) as Asset;

        // 4. Mark Completed
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
