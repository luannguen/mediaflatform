import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { workspaceService } from '@/services/workspaceService';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { AppError } from '@/lib/errors/app-error';
import { ErrorCodes } from '@/lib/errors/codes';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: workspaceId } = await params;
    const principal = await authenticateRequest(req);

    // Verify user has access to this workspace
    const members = await workspaceService.getWorkspaceMembers(workspaceId);
    return successResponse(members);
  } catch (error) {
    return errorResponse(error);
  }
}
