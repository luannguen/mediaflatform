import { uploadSessionService } from '@/services/uploadSessionService';
import { withApiRoute } from '@/lib/platform/apiRoute';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { AppError } from '@/lib/errors/app-error';

async function handlePOST(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'uploads:create');
    const body = await req.json();

    const assetId = body.asset_id;
    if (!assetId) {
      throw AppError.badRequest('Field "asset_id" is required');
    }

    const { data: pendingSession, error: sessionError } = await supabaseAdmin.from('upload_sessions').select('id').eq('reserved_asset_id', assetId).eq('workspace_id', principal.workspaceId).maybeSingle();
    if (sessionError) throw AppError.serviceUnavailable('Upload session lookup failed');
    if (pendingSession) {
      const result = await uploadSessionService.completeSession({ sessionId: pendingSession.id, workspaceId: principal.workspaceId, callerUserId: principal.userId, callerServiceAccountId: principal.serviceAccountId, clientChecksum: body.checksum });
      return successResponse({ ...result.asset, job_id: result.job?.id || null }, { idempotent: result.idempotent });
    }
    throw AppError.conflict('This upload predates durable upload sessions. Start a new upload session to verify and process the source safely.');
  } catch (error) {
    return errorResponse(error);
  }
}

export const dynamic = 'force-dynamic';

export const POST = withApiRoute(handlePOST, 'uploads:create');
