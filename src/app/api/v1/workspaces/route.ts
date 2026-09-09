import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { workspaceService } from '@/services/workspaceService';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { AppError } from '@/lib/errors/app-error';
import { ErrorCodes } from '@/lib/errors/codes';

export async function GET(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req);

    if (!principal.userId) {
      throw AppError.unauthorized('User identity required to list workspaces', ErrorCodes.AUTH_REQUIRED);
    }

    const workspaces = await workspaceService.getUserWorkspaces(principal.userId);
    return successResponse(workspaces);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req);

    if (!principal.userId) {
      throw AppError.unauthorized('User identity required to create workspace', ErrorCodes.AUTH_REQUIRED);
    }

    const body = await req.json();
    const { name, description } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      throw AppError.badRequest('Workspace name is required', ErrorCodes.VALIDATION_ERROR);
    }

    const newWorkspace = await workspaceService.createWorkspace(principal.userId, {
      name,
      description,
    });

    return successResponse(newWorkspace, {}, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
