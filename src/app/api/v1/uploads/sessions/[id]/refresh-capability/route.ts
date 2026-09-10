import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { uploadSessionService } from '@/services/uploadSessionService';
import { successResponse, errorResponse } from '@/lib/errors/response';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params;
    const principal = await authenticateRequest(req, 'uploads:create');

    const capability = await uploadSessionService.refreshCapability(
      sessionId,
      principal.workspaceId
    );

    return successResponse(
      {
        capability,
      },
      {
        session_id: sessionId,
        upload_url: capability.uploadUrl,
        expires_at: capability.expiresAt,
      },
      200
    );
  } catch (error) {
    return errorResponse(error);
  }
}
