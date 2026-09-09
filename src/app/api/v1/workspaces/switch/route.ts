import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { workspaceService } from '@/services/workspaceService';
import { createSessionToken, SESSION_COOKIE_NAME, verifySessionToken } from '@/lib/auth/session';
import { AppError } from '@/lib/errors/app-error';
import { ErrorCodes } from '@/lib/errors/codes';

export async function POST(req: NextRequest) {
  try {
    const sessionCookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    const session = await verifySessionToken(sessionCookie);

    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'No active session found' } },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { workspaceId } = body;

    if (!workspaceId) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Target workspaceId is required' } },
        { status: 400 }
      );
    }

    const targetWs = await workspaceService.getWorkspaceById(workspaceId);
    if (!targetWs) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Target workspace not found' } },
        { status: 404 }
      );
    }

    // Check membership and role in target workspace
    // If user is super admin or owner, they are owner in any of their workspaces or ws_default
    let role = await workspaceService.getUserRoleInWorkspace(session.userId, workspaceId, session.email);

    if (!role) {
      if (session.userId === 'usr_super_admin_configured' || session.userId === 'usr_super_admin' || session.role === 'owner') {
        role = 'owner';
      } else {
        return NextResponse.json(
          {
            error: {
              code: 'FORBIDDEN',
              message: 'You do not have active membership in this workspace',
            },
          },
          { status: 403 }
        );
      }
    }

    // Issue updated session token for the new active workspace
    const newToken = await createSessionToken({
      userId: session.userId,
      email: session.email,
      name: session.name,
      role: role,
      workspaceId: targetWs.id,
      organizationId: targetWs.organization_id,
    });

    const response = NextResponse.json({
      success: true,
      data: {
        workspace: {
          id: targetWs.id,
          name: targetWs.name,
          slug: targetWs.slug,
          role: role,
        },
        user: {
          id: session.userId,
          name: session.name,
          email: session.email,
          role: role,
        },
      },
    });

    // Update HTTP-only session cookie
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: newToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });

    return response;
  } catch (err: any) {
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: err.message || 'Switch workspace failed' } },
      { status: 500 }
    );
  }
}
