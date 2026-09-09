import React, { useState } from 'react';
import { Image, View, StyleSheet, ImageProps } from 'react-native';

export interface RNMediaImageProps {
  assetId: string;
  baseUrl?: string;
  apiKey?: string;
  width?: number;
  height?: number;
  quality?: number;
  format?: 'webp' | 'avif' | 'jpeg' | 'png';
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside' | 'focal';
  focalX?: number;
  focalY?: number;
  style?: any;
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'repeat' | 'center';
  placeholderColor?: string;
  onLoad?: () => void;
  onError?: (error: any) => void;
  accessibilityLabel?: string;
}

/**
 * Media Platform Image Component for React Native
 * Automatically generates optimized CDN delivery URLs with responsive dimensions,
 * WebP/AVIF format negotiation, and Focal Point cropping.
 */
export function MediaImage({
  assetId,
  baseUrl = 'http://localhost:3000',
  apiKey,
  width,
  height,
  quality = 80,
  format = 'webp',
  fit = 'cover',
  focalX,
  focalY,
  style,
  resizeMode = 'cover',
  placeholderColor = '#1e293b',
  onLoad,
  onError,
  accessibilityLabel,
}: RNMediaImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  // Construct CDN URL with transformation query parameters
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const params = new URLSearchParams();
  if (width) params.set('width', String(Math.round(width)));
  if (height) params.set('height', String(Math.round(height)));
  if (quality) params.set('quality', String(quality));
  if (format) params.set('format', format);
  if (fit) params.set('fit', fit);
  if (focalX !== undefined) params.set('focal_x', String(focalX));
  if (focalY !== undefined) params.set('focal_y', String(focalY));

  const queryString = params.toString();
  const deliveryUrl = `${cleanBase}/api/v1/delivery/${assetId}${queryString ? `?${queryString}` : ''}`;

  const headers: Record<string, string> = {};
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  return (
    <View style={[styles.container, { backgroundColor: placeholderColor }, style]}>
      <Image
        source={{
          uri: deliveryUrl,
          headers,
          cache: 'force-cache',
        }}
        style={[StyleSheet.absoluteFill, style]}
        resizeMode={resizeMode}
        onLoad={() => {
          setIsLoaded(true);
          onLoad?.();
        }}
        onError={(err) => {
          setHasError(true);
          onError?.(err);
        }}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
