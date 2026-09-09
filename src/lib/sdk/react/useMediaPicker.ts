'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

export interface UseMediaPickerOptions {
  apiKey: string;
  baseUrl?: string;
  multiple?: boolean;
  types?: ('image' | 'video' | 'audio' | 'document')[];
  title?: string;
  onSelect?: (asset: any) => void;
}

export interface UseMediaPickerReturn {
  openPicker: () => void;
  closePicker: () => void;
  selectedAsset: any | null;
  selectedAssets: any[];
  isOpen: boolean;
  clearSelection: () => void;
}

export function useMediaPicker({
  apiKey,
  baseUrl = '',
  multiple = false,
  types,
  title = 'Media Platform Picker',
  onSelect,
}: UseMediaPickerOptions): UseMediaPickerReturn {
  const [selectedAsset, setSelectedAsset] = useState<any | null>(null);
  const [selectedAssets, setSelectedAssets] = useState<any[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const popupRef = useRef<Window | null>(null);

  const closePicker = useCallback(() => {
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.close();
    }
    popupRef.current = null;
    setIsOpen(false);
  }, []);

  const openPicker = useCallback(() => {
    if (typeof window === 'undefined') return;

    const host = (baseUrl || window.location.origin).replace(/\/$/, '');
    const query = new URLSearchParams();
    query.set('api_key', apiKey);
    if (multiple) query.set('mode', 'multiple');
    if (types && types.length > 0) query.set('types', types.join(','));

    const pickerUrl = `${host}/picker?${query.toString()}`;
    const width = 1024;
    const height = 720;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const popup = window.open(
      pickerUrl,
      title,
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=yes`
    );

    popupRef.current = popup;
    setIsOpen(true);
  }, [apiKey, baseUrl, multiple, types, title]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleMessage = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== 'object') return;

      if (event.data.type === 'MEDIA_ASSET_SELECTED') {
        const asset = event.data.asset;
        setSelectedAsset(asset);
        if (asset) {
          setSelectedAssets((prev) => (multiple ? [...prev, asset] : [asset]));
        }
        if (onSelect) {
          onSelect(asset);
        }
        closePicker();
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      if (popupRef.current && !popupRef.current.closed) {
        popupRef.current.close();
      }
    };
  }, [closePicker, multiple, onSelect]);

  const clearSelection = useCallback(() => {
    setSelectedAsset(null);
    setSelectedAssets([]);
  }, []);

  return {
    openPicker,
    closePicker,
    selectedAsset,
    selectedAssets,
    isOpen,
    clearSelection,
  };
}
