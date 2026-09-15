import { hasScope } from '@/lib/security/api-key';
import { withApiRoute } from '@/lib/platform/apiRoute';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { uploadSessionService } from '@/services/uploadSessionService';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { AppError } from '@/lib/errors/app-error';
import { ErrorCodes } from '@/lib/errors/codes';
import { checkWorkspaceQuota, validateUploadLimits } from '@/lib/security/uploadPolicy';
import { AssetType } from '@/types/database';

function detectAssetType(mimeType: string, filename: string): AssetType {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (mimeType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'].includes(ext)) return 'image';
  if (mimeType.startsWith('video/') || ['mp4', 'mov', 'webm', 'mkv', 'avi'].includes(ext)) return 'video';
  if (mimeType.startsWith('audio/') || ['mp3', 'wav', 'aac', 'flac', 'ogg'].includes(ext)) return 'audio';
  if (mimeType === 'application/pdf' || ext === 'pdf') return 'document';
  if (mimeType.includes('zip') || mimeType.includes('tar') || ['zip', 'tar', 'gz'].includes(ext)) return 'archive';
  return 'other';
}

async function handlePOST(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'uploads:create');

    let body: any;
    try {
      body = await req.json();
    } catch {
      throw AppError.badRequest('Invalid JSON body', ErrorCodes.VALIDATION_ERROR);
    }

    const filename = body.filename || body.file_name || body.original_filename;
    const fileSizeBytes = Number(body.file_size ?? body.size_bytes ?? body.fileSizeBytes ?? body.file_size_bytes);
    const mimeType = body.mime_type || body.mimeType || 'application/octet-stream';
    const folderId = body.folder_id || body.folderId || null;
    const displayName = body.display_name || body.displayName;
    const visibility = body.visibility || 'workspace';
    const metadata = body.metadata || body.metadata_json || {};

    if (!filename || typeof filename !== 'string') {
      throw AppError.badRequest('Missing or invalid "filename"', ErrorCodes.VALIDATION_ERROR);
    }

    if (isNaN(fileSizeBytes) || fileSizeBytes <= 0) {
      throw AppError.badRequest('Missing or invalid "file_size" (must be a positive integer)', ErrorCodes.VALIDATION_ERROR);
    }

    if (!['public', 'workspace', 'private'].includes(visibility)) {
      throw AppError.badRequest('Invalid "visibility". Allowed values: public, workspace, private', ErrorCodes.VALIDATION_ERROR);
    }

    if (visibility === 'public' && !hasScope(principal.scopes, 'assets:visibility:write')) throw AppError.forbidden('Public upload requires visibility permission');
    if (typeof mimeType !== 'string') throw AppError.badRequest('Invalid MIME type');
    // Validate size limits and workspace quota
    const assetType = detectAssetType(mimeType, filename);
    validateUploadLimits(assetType, fileSizeBytes);
    await checkWorkspaceQuota(principal.workspaceId, fileSizeBytes);

    // Create session and obtain direct-upload capability
    const result = await uploadSessionService.createSession({
      workspaceId: principal.workspaceId,
      filename,
      fileSizeBytes,
      mimeType,
      folderId,
      displayName,
      visibility,
      metadata,
      userId: principal.userId,
      serviceAccountId: principal.serviceAccountId,
    });

    return successResponse(
      {
        session: result.session,
        capability: result.capability,
      },
      {
        session_id: result.session.id,
        upload_url: result.capability.uploadUrl,
        protocol: result.capability.protocol,
        expires_at: result.capability.expiresAt,
      },
      201
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export const dynamic = 'force-dynamic';

export const POST = withApiRoute(handlePOST, 'uploads:create');
