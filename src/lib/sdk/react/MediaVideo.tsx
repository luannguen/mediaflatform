'use client';

import React, { useState, useRef, useEffect } from 'react';

export interface MediaVideoProps extends React.VideoHTMLAttributes<HTMLVideoElement> {
  assetId?: string;
  asset?: {
    id: string;
    display_name?: string;
    storage_url?: string | null;
  };
  baseUrl?: string;
  previewOnHover?: boolean;
  showTrailerOnHover?: boolean;
}

export function MediaVideo({
  assetId: propAssetId,
  asset,
  baseUrl = '',
  previewOnHover = true,
  showTrailerOnHover,
  className = '',
  controls = true,
  autoPlay = false,
  muted = false,
  loop = false,
  poster: customPoster,
  style,
  ...rest
}: MediaVideoProps) {
  const [isHovered, setIsHovered] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const enableTrailer = showTrailerOnHover !== undefined ? showTrailerOnHover : previewOnHover;

  const id = propAssetId || asset?.id;
  if (!id) return null;

  const host = baseUrl.replace(/\/$/, '');
  const hlsStreamUrl = `${host}/api/v1/delivery/video/${id}/master.m3u8`;
  const defaultPoster = customPoster || `${host}/api/v1/delivery/video/${id}/poster.webp`;
  const previewTrailerUrl = `${host}/api/v1/delivery/video/${id}/preview.webp`;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Check if browser natively supports HLS (Safari/iOS)
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsStreamUrl;
    } else if (asset?.storage_url) {
      // Direct MP4 fallback for browsers without native HLS unless HLS.js is bundled
      video.src = asset.storage_url;
    }
  }, [hlsStreamUrl, asset?.storage_url]);

  return (
    <div
      className={`relative overflow-hidden rounded-xl bg-slate-950 ${className}`}
      style={{ display: 'inline-block', ...style }}
      onMouseEnter={() => {
        if (enableTrailer) setIsHovered(true);
      }}
      onMouseLeave={() => {
        if (enableTrailer) setIsHovered(false);
      }}
    >
      {enableTrailer && isHovered && (
        <div className="absolute inset-0 z-20 pointer-events-none bg-slate-950/40 backdrop-blur-xs flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewTrailerUrl}
            alt="Video Preview"
            className="w-full h-full object-cover animate-fade-in"
          />
        </div>
      )}

      <video
        ref={videoRef}
        poster={defaultPoster}
        controls={controls}
        autoPlay={autoPlay}
        muted={muted}
        loop={loop}
        playsInline
        className="w-full h-full object-cover"
        {...rest}
      />
    </div>
  );
}
