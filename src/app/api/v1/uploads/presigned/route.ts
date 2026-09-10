import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { AppError } from '@/lib/errors/app-error';
import { generateId } from '@/lib/ids/generator';
import { getStorageProvider } from '@/lib/storage/factory';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { mockDb } from '@/lib/mock/store';
import { Asset, AssetType } from '@/types/database';
import { validateUploadLimits, checkWorkspaceQuota } from '@/lib/security/uploadPolicy';

function detectAssetType(mime: string): AssetType {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf' || mime.includes('document') || mime.includes('text/')) return 'document';
  if (mime.includes('zip') || mime.includes('tar') || mime.includes('gzip')) return 'archive';
  return 'other';
}

export async function POST(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'uploads:create');
    const body = await req.json();

    const filename = (body.filename || body.original_filename || '').trim();
    const mimeType = (body.mime_type || body.mimeType || 'application/octet-stream').trim().toLowerCase();
    const sizeBytes = typeof body.size_bytes === 'number' ? body.size_bytes : 0;
    const folderId = body.folder_id || null;
    let visibility = body.visibility || 'workspace';
    const expiresIn = typeof body.expires_in === 'number' ? Math.min(3600, Math.max(60, body.expires_in)) : 900;

    if (!filename) {
      throw AppError.badRequest('Field "filename" is required');
    }

    const assetType = detectAssetType(mimeType);

    // Enforce size limits and workspace quotas
    if (sizeBytes > 0) {
      validateUploadLimits(assetType, sizeBytes);
      await checkWorkspaceQuota(principal.workspaceId, sizeBytes);
    }

    // Uploader/Viewer cannot make new uploads directly public
    if (visibility === 'public' && (principal.role === 'uploader' || principal.role === 'viewer')) {
      visibility = 'workspace';
    }

    const storageProvider = getStorageProvider();
    const assetId = generateId('med');
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageKey = `uploads/${principal.workspaceId}/${Date.now()}_${sanitizedFilename}`;

    // 1. Generate presigned upload URL directly to storage bucket
    const presigned = await storageProvider.createPresignedUploadUrl(storageKey, mimeType, expiresIn);
    const storageUrl = storageProvider.getPublicUrl(storageKey);
    const now = new Date().toISOString();

    const newAsset: Asset = {
      id: assetId,
      workspace_id: principal.workspaceId,
      folder_id: folderId,
      asset_type: assetType,
      original_filename: filename,
      display_name: filename.replace(/\.[^/.]+$/, ''),
      mime_type: mimeType,
      extension: filename.split('.').pop() || '',
      size_bytes: sizeBytes,
      storage_provider: storageProvider.name,
      storage_bucket: 'media-assets',
      storage_key: storageKey,
      storage_url: storageUrl,
      checksum_algorithm: 'sha256',
      visibility,
      status: 'uploading',
      processing_status: 'pending',
      created_by_user_id: principal.userId,
      created_by_service_account_id: principal.serviceAccountId,
      metadata_json: {
        presigned_at: now,
        direct_upload: true,
      },
      created_at: now,
      updated_at: now,
    };

    // 2. Persist initial asset record with 'uploading' status
    if (isSupabaseAdminConfigured()) {
      const { error } = await supabaseAdmin.from('assets').insert(newAsset);
      if (error) {
        throw AppError.internal(`Failed to initialize upload session: ${error.message}`);
      }
    } else {
      mockDb.assets.unshift(newAsset);
    }

    return successResponse(
      {
        asset_id: assetId,
        upload_url: presigned.uploadUrl,
        storage_key: storageKey,
        method: presigned.method,
        token: presigned.token,
        headers: presigned.headers || { 'Content-Type': mimeType },
        expires_in: presigned.expiresInSeconds,
        expires_in_seconds: presigned.expiresInSeconds,
        storage_url: storageUrl,
        confirm_endpoint: `/api/v1/uploads/confirm`,
      },
      {},
      201
    );
  } catch (error) {
    return errorResponse(error);
  }
}
