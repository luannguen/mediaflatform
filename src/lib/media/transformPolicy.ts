import crypto from 'crypto';
import { AppError } from '@/lib/errors/app-error';

export const MAX_IMAGE_INPUT_BYTES = 50 * 1024 * 1024; // 50MB
export const MAX_IMAGE_WIDTH = 8192;
export const MAX_IMAGE_HEIGHT = 8192;
export const MAX_IMAGE_PIXELS = 36 * 1024 * 1024; // 36MP

export const MAX_TRANSFORM_WIDTH = 4096;
export const MAX_TRANSFORM_HEIGHT = 4096;
export const MAX_TRANSFORM_PIXELS = 16 * 1024 * 1024; // 16MP
export const MAX_WATERMARK_TEXT_LENGTH = 100;

export interface TransformSpec {
  width?: number;
  height?: number;
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside' | 'smart' | 'focal';
  format?: 'webp' | 'avif' | 'jpeg' | 'png';
  quality?: number;
  focal_x?: number;
  focal_y?: number;
  watermark_text?: string;
  watermark_pos?: string;
  watermark_opacity?: number;
}

export interface CanonicalProfile {
  name: string;
  width: number;
}

export const CANONICAL_IMAGE_PROFILES: CanonicalProfile[] = [
  { name: 'thumb', width: 160 },
  { name: 'small', width: 320 },
  { name: 'medium', width: 768 },
  { name: 'large', width: 1280 },
  { name: 'xlarge', width: 1920 },
];

export function validateTransformDimensions(width?: number, height?: number): void {
  if (width !== undefined) {
    if (isNaN(width) || width <= 0) {
      throw AppError.badRequest('Invalid transform width (must be positive integer)', 'INVALID_TRANSFORM');
    }
    if (width > MAX_TRANSFORM_WIDTH) {
      throw AppError.badRequest(`Transform width ${width}px exceeds maximum allowed ${MAX_TRANSFORM_WIDTH}px`, 'IMAGE_DIMENSION_LIMIT_EXCEEDED');
    }
  }

  if (height !== undefined) {
    if (isNaN(height) || height <= 0) {
      throw AppError.badRequest('Invalid transform height (must be positive integer)', 'INVALID_TRANSFORM');
    }
    if (height > MAX_TRANSFORM_HEIGHT) {
      throw AppError.badRequest(`Transform height ${height}px exceeds maximum allowed ${MAX_TRANSFORM_HEIGHT}px`, 'IMAGE_DIMENSION_LIMIT_EXCEEDED');
    }
  }

  if (width !== undefined && height !== undefined) {
    const pixels = width * height;
    if (pixels > MAX_TRANSFORM_PIXELS) {
      throw AppError.badRequest(`Transform total pixels ${pixels} exceeds ${MAX_TRANSFORM_PIXELS} limit`, 'IMAGE_PIXEL_LIMIT_EXCEEDED');
    }
  }
}

/**
 * Compute deterministic transform hash key for disk/storage caching
 */
export function computeTransformKey(assetId: string, sourceVersion: string, spec: TransformSpec): { transformHash: string; storageKey: string } {
  const normWidth = spec.width || 'orig';
  const normHeight = spec.height || 'orig';
  const normFit = spec.fit || 'cover';
  const normFormat = spec.format || 'webp';
  const normQuality = spec.quality || 80;
  const normFocal = (spec.fit === 'focal' || spec.focal_x !== undefined)
    ? `focal_${spec.focal_x ?? 0.5}_${spec.focal_y ?? 0.5}`
    : 'nofocal';
  const normWatermark = spec.watermark_text
    ? `wm_${spec.watermark_text.slice(0, MAX_WATERMARK_TEXT_LENGTH)}_${spec.watermark_pos || 'br'}_${spec.watermark_opacity || 0.7}`
    : 'nowm';

  const canonicalString = [
    assetId,
    sourceVersion,
    normWidth,
    normHeight,
    normFit,
    normFormat,
    normQuality,
    normFocal,
    normWatermark,
  ].join('::');

  const transformHash = crypto.createHash('sha256').update(canonicalString).digest('hex').slice(0, 24);
  const storageKey = `transforms/${assetId}/${sourceVersion}/${transformHash}.${normFormat}`;

  return { transformHash, storageKey };
}

export const getTransformCacheKey = (
  assetId: string,
  sourceVersion: string,
  spec: TransformSpec & { watermark?: string; focalX?: number; focalY?: number }
): string => {
  return computeTransformKey(assetId, sourceVersion, {
    ...spec,
    focal_x: spec.focal_x ?? spec.focalX,
    focal_y: spec.focal_y ?? spec.focalY,
    watermark_text: spec.watermark_text ?? spec.watermark,
  }).storageKey;
};

/**
 * Find matching canonical variant profile if request matches standard dimensions exactly
 */
export function matchCanonicalVariantProfile(width?: number, height?: number, format: string = 'webp'): string | null {
  if (height) return null; // Canonical profiles are width-governed
  if (format !== 'webp') return null; // Canonical storage format is WebP

  if (!width) return null;
  const profile = CANONICAL_IMAGE_PROFILES.find((p) => p.width === width);
  return profile ? profile.name : null;
}

export const findCanonicalVariantMatch = matchCanonicalVariantProfile;
