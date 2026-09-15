import { withApiRoute } from '@/lib/platform/apiRoute';
import { NextRequest } from 'next/server';
import { invitationService } from '@/services/invitationService';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { AppError } from '@/lib/errors/app-error';
import { ErrorCodes } from '@/lib/errors/codes';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/lib/auth/session';

async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: invitationId } = await params;
    const sessionCookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    const session = await verifySessionToken(sessionCookie);

    if (!session || !session.email) {
      throw AppError.unauthorized('Authentication required to decline invitations', ErrorCodes.AUTH_REQUIRED);
    }

    await invitationService.declineInvitation(invitationId, session.userId);
    return successResponse({ declined: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export const dynamic = 'force-dynamic';

export const POST = withApiRoute(handlePOST);
