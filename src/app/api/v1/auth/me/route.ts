import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, verifySessionToken, createSessionToken } from '@/lib/auth/session';
import { resolveAuthorizedWorkspace } from '@/lib/security/workspace-resolver';

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    const session = await verifySessionToken(token);

    if (!session) {
      return NextResponse.json(
        {
          error: {
            code: 'UNAUTHENTICATED',
            message: 'No active session found',
          },
        },
        { status: 401 }
      );
    }

    // Authorize workspace & resolve current authoritative role directly from PostgreSQL
    const resolved = await resolveAuthorizedWorkspace({
      userId: session.userId,
      userEmail: session.email,
      requestedWorkspaceId: session.workspaceId,
    });

    const activeWs = resolved.workspace;
    const activeRole = resolved.role;

    // Check if session token was stale/cached with a ghost workspace or stale role
    const needsCookieRefresh =
      Boolean(resolved.sessionNeedsRefresh) ||
      session.workspaceId !== activeWs.id ||
      session.role !== activeRole ||
      session.organizationId !== activeWs.organization_id;

    const response = NextResponse.json({
      success: true,
      data: {
        user: {
          id: session.userId,
          email: session.email,
          name: session.name,
          role: activeRole,
        },
        workspace: {
          id: activeWs.id,
          organization_id: activeWs.organization_id,
          name: activeWs.name,
          slug: activeWs.slug,
          description: activeWs.description || null,
          quota_storage_bytes: Number(activeWs.quota_storage_bytes) || 10737418240,
          quota_asset_count: Number(activeWs.quota_asset_count) || 50000,
        },
      },
    });

    // Auto-heal session cookie in HTTP response header if mismatched
    if (needsCookieRefresh) {
      const refreshedToken = await createSessionToken({
        userId: session.userId,
        email: session.email,
        name: session.name,
        role: activeRole,
        workspaceId: activeWs.id,
        organizationId: activeWs.organization_id,
      });

      response.cookies.set({
        name: SESSION_COOKIE_NAME,
        value: refreshedToken,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
      });
    }

    return response;
  } catch (err: any) {
    const status = err.statusCode || (err.code === 'WORKSPACE_ACCESS_DENIED' ? 403 : 500);
    return NextResponse.json(
      {
        error: {
          code: err.code || 'INTERNAL_ERROR',
          message: err.message || 'Failed to fetch user session profile',
        },
      },
      { status }
    );
  }
}
