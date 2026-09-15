import { withApiRoute } from '@/lib/platform/apiRoute';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { workspaceService } from '@/services/workspaceService';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { AppError } from '@/lib/errors/app-error';
import { ErrorCodes } from '@/lib/errors/codes';

async function handleGET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: workspaceId } = await params;
    const principal = await authenticateRequest(req);
    if (principal.workspaceId !== workspaceId || principal.type !== 'user') {
      throw AppError.forbidden('Workspace access denied', ErrorCodes.WORKSPACE_ACCESS_DENIED);
    }

    // Verify user has access to this workspace
    const members = await workspaceService.getWorkspaceMembers(workspaceId);
    return successResponse(members);
  } catch (error) {
    return errorResponse(error);
  }
}

export const dynamic = 'force-dynamic';

export const GET = withApiRoute(handleGET);
