import { requireActiveIdentity } from '@/lib/auth/server';
import { withApiRoute } from '@/lib/platform/apiRoute';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { invitationService } from '@/services/invitationService';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { AppError } from '@/lib/errors/app-error';
import { ErrorCodes } from '@/lib/errors/codes';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/lib/auth/session';

async function handleGET(req: NextRequest) {
  try {
    const sessionCookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    const session = await verifySessionToken(sessionCookie);

    if (!session || !session.email) {
      throw AppError.unauthorized('Authentication required to view pending invitations', ErrorCodes.AUTH_REQUIRED);
    }

    const invitations = await invitationService.getPendingInvitationsForEmail((await requireActiveIdentity(session.userId)).email!);
    return successResponse(invitations);
  } catch (error) {
    return errorResponse(error);
  }
}

export const dynamic = 'force-dynamic';

export const GET = withApiRoute(handleGET);
