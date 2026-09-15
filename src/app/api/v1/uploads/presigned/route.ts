import { NextRequest } from 'next/server';
import { withApiRoute } from '@/lib/platform/apiRoute';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { uploadSessionService } from '@/services/uploadSessionService';
import { successResponse } from '@/lib/errors/response';
import { AppError } from '@/lib/errors/app-error';
import { hasScope } from '@/lib/security/api-key';
async function handlePOST(req: NextRequest) {
  const p = await authenticateRequest(req, 'uploads:create');
  const b = await req.json();
  if (b.visibility === 'public' && !hasScope(p.scopes, 'assets:visibility:write')) throw AppError.forbidden('Public upload requires visibility permission');
  const { session, capability: c } = await uploadSessionService.createSession({ workspaceId: p.workspaceId, filename: b.filename || b.original_filename, mimeType: b.mime_type || b.mimeType || 'application/octet-stream', fileSizeBytes: b.size_bytes, folderId: b.folder_id, displayName: b.display_name, visibility: b.visibility, userId: p.userId, serviceAccountId: p.serviceAccountId });
  return successResponse({ asset_id: session.reserved_asset_id, session_id: session.id, upload_url: c.uploadUrl, storage_key: c.storageKey, method: c.method, token: c.token, headers: c.headers, expires_in: c.expiresInSeconds, expires_in_seconds: c.expiresInSeconds, confirm_endpoint: '/api/v1/uploads/confirm' }, {}, 201);
}
export const dynamic = 'force-dynamic';
export const POST = withApiRoute(handlePOST, 'uploads:create');
