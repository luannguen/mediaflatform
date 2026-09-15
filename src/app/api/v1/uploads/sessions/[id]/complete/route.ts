import { withApiRoute } from '@/lib/platform/apiRoute';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { uploadSessionService } from '@/services/uploadSessionService';
import { successResponse, errorResponse } from '@/lib/errors/response';

async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params;
    const principal = await authenticateRequest(req, 'uploads:create');

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // Body is optional for completion
    }

    const clientChecksum = body.client_checksum || body.checksum || null;

    const result = await uploadSessionService.completeSession({
      sessionId,
      workspaceId: principal.workspaceId,
      callerUserId: principal.userId,
      callerServiceAccountId: principal.serviceAccountId,
      clientChecksum,
    });

    return successResponse(
      {
        asset: result.asset,
        job: result.job,
      },
      {
        session_id: sessionId,
        idempotent: result.idempotent,
        job_id: result.job?.id || null,
        asset_id: result.asset.id,
      },
      result.idempotent ? 200 : 201
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export const dynamic = 'force-dynamic';

export const POST = withApiRoute(handlePOST, 'uploads:create');
