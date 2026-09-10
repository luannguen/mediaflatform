import { Asset, Visibility, AssetType } from '@/types/database';

export interface DeliveryPolicyResult {
  cacheControl: string;
  contentDisposition: string;
  contentTypeOptions: string;
  isPrivate: boolean;
  headers: Record<string, string>;
}

export interface DeliveryPolicyOptions {
  forceDownload?: boolean;
  customFilename?: string;
  filename?: string;
  overrideContentType?: string;
  contentType?: string;
  disposition?: 'inline' | 'attachment';
}

/**
 * Centralized Delivery Policy for Media Platform
 * Strict Security Rule: Private/Workspace assets MUST NEVER receive public/s-maxage/immutable caching!
 */
export function getDeliveryPolicy(
  asset: Asset,
  options: DeliveryPolicyOptions = {}
): DeliveryPolicyResult {
  const isPrivate = asset.visibility === 'private' || asset.visibility === 'workspace';

  // 1. Cache-Control Header
  let cacheControl: string;
  if (isPrivate) {
    cacheControl = 'private, no-cache, no-store, must-revalidate';
  } else {
    cacheControl = 'public, max-age=31536000, s-maxage=31536000, immutable';
  }

  // 2. Content-Disposition Header
  const filename = options.filename || options.customFilename || asset.display_name || asset.original_filename || 'download';
  const extension = asset.extension ? `.${asset.extension.replace(/^\./, '')}` : '';
  const fullName = filename.endsWith(extension) ? filename : `${filename}${extension}`;
  const sanitizedAscii = fullName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const encodedUtf8 = encodeURIComponent(fullName);

  const isArchiveOrExecutable =
    asset.asset_type === 'archive' ||
    asset.mime_type.includes('zip') ||
    asset.mime_type.includes('tar') ||
    asset.mime_type.includes('executable');

  const dispositionType = options.disposition || ((options.forceDownload || isArchiveOrExecutable) ? 'attachment' : 'inline');
  const contentDisposition = `${dispositionType}; filename="${sanitizedAscii}"; filename*=UTF-8''${encodedUtf8}`;

  const contentType = options.contentType || options.overrideContentType;

  const headers: Record<string, string> = {
    'Cache-Control': cacheControl,
    'Content-Disposition': contentDisposition,
    'X-Content-Type-Options': 'nosniff',
  };
  if (isPrivate) {
    headers['Referrer-Policy'] = 'no-referrer';
  }
  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  return {
    cacheControl,
    contentDisposition,
    contentTypeOptions: 'nosniff',
    isPrivate,
    headers,
  };
}

/**
 * Cache-Control for ETag / 304 Not Modified Responses
 * Retains strict privacy semantics for private assets!
 */
export function get304CacheControl(assetOrVisibility: Asset | Visibility | string): string {
  const visibility =
    typeof assetOrVisibility === 'object' && assetOrVisibility
      ? (assetOrVisibility as Asset).visibility
      : assetOrVisibility;

  if (visibility === 'private' || visibility === 'workspace') {
    return 'private, no-cache, no-store, must-revalidate';
  }
  return 'public, max-age=31536000, s-maxage=31536000, immutable';
}
