import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { invitationService } from '@/services/invitationService';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { AppError } from '@/lib/errors/app-error';
import { ErrorCodes } from '@/lib/errors/codes';
import { UserRole } from '@/lib/auth/session';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: workspaceId } = await params;
    const principal = await authenticateRequest(req);

    if (principal.role !== 'owner' && principal.role !== 'admin') {
      throw AppError.forbidden('Only workspace owners and admins can view sent invitations', ErrorCodes.PERMISSION_DENIED);
    }

    const invitations = await invitationService.getWorkspaceInvitations(workspaceId);
    return successResponse(invitations);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: workspaceId } = await params;
    const principal = await authenticateRequest(req);

    if (principal.role !== 'owner' && principal.role !== 'admin') {
      throw AppError.forbidden('Only workspace owners and admins can invite members', ErrorCodes.PERMISSION_DENIED);
    }

    const body = await req.json();
    const { email, role = 'viewer' } = body;

    if (!email || !email.includes('@')) {
      throw AppError.badRequest('A valid email address is required', ErrorCodes.VALIDATION_ERROR);
    }

    const validRoles: UserRole[] = ['admin', 'media_manager', 'editor', 'uploader', 'viewer', 'developer'];
    if (!validRoles.includes(role as UserRole)) {
      throw AppError.badRequest(`Invalid role: ${role}`, ErrorCodes.VALIDATION_ERROR);
    }

    const inviterName = principal.type === 'user' ? 'Team Admin' : 'Workspace Admin';
    const invitation = await invitationService.createInvitation(
      workspaceId,
      { id: principal.userId || 'admin', name: inviterName },
      email,
      role as UserRole
    );

    return successResponse(invitation, {}, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
