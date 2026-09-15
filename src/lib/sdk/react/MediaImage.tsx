'use client';

import React, { useState } from 'react';

export interface MediaImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  assetId?: string;
  asset?: {
    id: string;
    display_name?: string;
    width?: number | null;
    height?: number | null;
    storage_url?: string | null;
    mime_type?: string;
  };
  baseUrl?: string;
  width?: number;
  height?: number;
  quality?: number;
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside' | 'smart';
  watermark?: string;
  watermarkPos?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'center';
  watermarkOpacity?: number;
  placeholder?: 'blur' | 'empty';
  blurDataURL?: string;
  priority?: boolean;
}

export function MediaImage({
  assetId: propAssetId,
  asset,
  baseUrl = '',
  width,
  height,
  quality = 80,
  fit = 'cover',
  watermark,
  watermarkPos,
  watermarkOpacity,
  placeholder = 'empty',
  blurDataURL,
  priority = false,
  alt = '',
  className = '',
  style,
  ...rest
}: MediaImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);

  const id = propAssetId || asset?.id;
  if (!id) {
    return null;
  }

  const buildUrl = (targetWidth: number, targetFormat: string) => {
    const params = new URLSearchParams();
    params.set('w', targetWidth.toString());
    if (height && width) {
      // maintain aspect ratio when scaling width
      const targetHeight = Math.round((height / width) * targetWidth);
      params.set('h', targetHeight.toString());
    }
    params.set('format', targetFormat);
    params.set('q', quality.toString());
    params.set('fit', fit);

    if (watermark) {
      params.set('watermark', watermark);
      if (watermarkPos) params.set('watermark_pos', watermarkPos);
      if (watermarkOpacity !== undefined) params.set('watermark_opacity', watermarkOpacity.toString());
    }

    const host = baseUrl.replace(/\/$/, '');
    return `${host}/api/v1/delivery/${id}?${params.toString()}`;
  };

  const targetWidths = [360, 640, 960, 1280, 1920];
  const activeWidths = width ? targetWidths.filter((w) => w <= width * 2) : targetWidths;
  if (width && !activeWidths.includes(width)) activeWidths.push(width);
  activeWidths.sort((a, b) => a - b);

  const avifSrcSet = activeWidths.map((w) => `${buildUrl(w, 'avif')} ${w}w`).join(', ');
  const webpSrcSet = activeWidths.map((w) => `${buildUrl(w, 'webp')} ${w}w`).join(', ');
  const defaultSrc = buildUrl(width || 800, 'webp');

  // Low-quality placeholder URL (width: 32px, quality: 30)
  const lqipUrl = blurDataURL || buildUrl(32, 'webp');

  const cssObjectFit: React.CSSProperties['objectFit'] =
    fit === 'contain' || fit === 'inside' || fit === 'outside'
      ? 'contain'
      : fit === 'fill'
      ? 'fill'
      : 'cover';

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{
        display: 'inline-block',
        aspectRatio: width && height ? `${width} / ${height}` : undefined,
        ...style,
      }}
    >
      {placeholder === 'blur' && !isLoaded && (
        <img
          src={lqipUrl}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover filter blur-lg scale-110 transition-opacity duration-500"
        />
      )}

      <picture>
        <source type="image/avif" srcSet={avifSrcSet} />
        <source type="image/webp" srcSet={webpSrcSet} />
        <img
          src={defaultSrc}
          alt={alt || asset?.display_name || ''}
          loading={priority ? 'eager' : 'lazy'}
          decoding={priority ? 'sync' : 'async'}
          onLoad={() => setIsLoaded(true)}
          className={`w-full h-full transition-opacity duration-300 ${
            placeholder === 'blur' && !isLoaded ? 'opacity-0' : 'opacity-100'
          }`}
          style={{ objectFit: cssObjectFit }}
          {...rest}
        />
      </picture>
    </div>
  );
}
