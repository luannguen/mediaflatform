'use client';

import { useState, useRef } from 'react';
import { useUpload } from '@/hooks/useUpload';
import { useFolders } from '@/hooks/useFolders';
import { X, UploadCloud, File, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Asset } from '@/types/database';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUploaded: (asset: Asset) => void;
}

export function UploadModal({ isOpen, onClose, onUploaded }: UploadModalProps) {
  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { folders } = useFolders();
  const { uploading, items, uploadFiles, clearQueue } = useUpload((asset) => {
    onUploaded(asset);
  });

  if (!isOpen) return null;

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFiles(Array.from(e.dataTransfer.files), selectedFolder || null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      uploadFiles(Array.from(e.target.files), selectedFolder || null);
    }
  };

  const handleClose = () => {
    clearQueue();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-100">Upload Media Assets</h3>
            <p className="text-xs text-slate-400">Directly ingest images, videos and documents</p>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {/* Target Folder Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
              Upload into Folder (Optional)
            </label>
            <select
              value={selectedFolder}
              onChange={(e) => setSelectedFolder(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-violet-500"
            >
              <option value="">Root Library (No folder)</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  📁 {f.name}
                </option>
              ))}
            </select>
          </div>

          {/* Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition flex flex-col items-center justify-center ${
              dragOver
                ? 'border-violet-500 bg-violet-500/10'
                : 'border-slate-700 bg-slate-950/50 hover:border-slate-600 hover:bg-slate-950'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileChange}
              className="hidden"
            />
            <div className="h-12 w-12 rounded-full bg-violet-600/10 flex items-center justify-center text-violet-400 mb-3">
              <UploadCloud className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium text-slate-200">
              Drag and drop files here, or <span className="text-violet-400 underline">browse</span>
            </p>
            <p className="text-xs text-slate-400 mt-1">Supports PNG, JPG, WebP, SVG, MP4, PDF up to 50MB</p>
          </div>

          {/* Upload Queue Progress */}
          {items.length > 0 && (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {items.map((item, idx) => (
                <div
                  key={idx}
                  className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <File className="h-4 w-4 text-slate-400 flex-shrink-0" />
                    <span className="text-slate-200 truncate max-w-xs">{item.filename}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.status === 'uploading' && (
                      <span className="flex items-center gap-1.5 text-violet-400">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Uploading...
                      </span>
                    )}
                    {item.status === 'completed' && (
                      <span className="flex items-center gap-1 text-emerald-400 font-medium">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Done
                      </span>
                    )}
                    {item.status === 'failed' && (
                      <span className="flex items-center gap-1 text-rose-400 font-medium">
                        <AlertCircle className="h-3.5 w-3.5" />
                        Failed
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/40 flex justify-end gap-3">
          <button
            onClick={handleClose}
            className="px-4 py-2 rounded-lg border border-slate-700 hover:bg-slate-800 text-sm font-medium text-slate-300 transition"
          >
            {items.some((i) => i.status === 'completed') ? 'Done' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
