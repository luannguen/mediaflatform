import { withApiRoute } from '@/lib/platform/apiRoute';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { uploadSessionService } from '@/services/uploadSessionService';
import { getStorageProvider } from '@/lib/storage/factory';
import { successResponse } from '@/lib/errors/response';
import { AppError } from '@/lib/errors/app-error';
import { hasScope } from '@/lib/security/api-key';

async function handlePOST(req: NextRequest) {
  const principal = await authenticateRequest(req, 'uploads:create');
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) throw AppError.badRequest('A nonempty file is required');
  if (file.size > 4 * 1024 * 1024) throw new AppError('Use upload sessions for files over 4 MiB', 'DIRECT_UPLOAD_REQUIRED', 413);
  const visibility = String(form.get('visibility') || 'workspace') as 'workspace';
  if (visibility === 'public' as string && !hasScope(principal.scopes, 'assets:visibility:write')) throw AppError.forbidden('Public upload requires visibility permission');
  const { session } = await uploadSessionService.createSession({ workspaceId: principal.workspaceId, filename: file.name, mimeType: file.type || 'application/octet-stream', fileSizeBytes: file.size, visibility, folderId: form.get('folder_id') as string || null, displayName: form.get('display_name') as string || undefined, userId: principal.userId, serviceAccountId: principal.serviceAccountId });
  await getStorageProvider().upload(Buffer.from(await file.arrayBuffer()), session.storage_key, session.mime_type, session.storage_bucket);
  // On uncertain finalization retain the object and durable session for reconciliation/expiry cleanup.
  const result = await uploadSessionService.completeSession({ sessionId: session.id, workspaceId: principal.workspaceId, callerUserId: principal.userId, callerServiceAccountId: principal.serviceAccountId });
  return successResponse({ ...result.asset, job_id: result.job?.id || null, job_status: result.job?.status || null }, {}, 201);
}
export const dynamic = 'force-dynamic';
export const POST = withApiRoute(handlePOST, 'uploads:create');
