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

    if (!session || !session.userId || !session.email) {
      throw AppError.unauthorized('Authentication required to accept invitations', ErrorCodes.AUTH_REQUIRED);
    }

    const result = await invitationService.acceptInvitation(invitationId, {
      id: session.userId,
      email: session.email,
      name: session.name,
    });

    return successResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export const dynamic = 'force-dynamic';

export const POST = withApiRoute(handlePOST);
