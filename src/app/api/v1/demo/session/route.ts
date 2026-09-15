import { NextRequest, NextResponse } from 'next/server';
import { withApiRoute } from '@/lib/platform/apiRoute';
import { requireActiveIdentity } from '@/lib/auth/server';
import { resolveAuthorizedWorkspace } from '@/lib/security/workspace-resolver';
import { createSessionToken, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { AppError } from '@/lib/errors/app-error';

async function handlePOST(_req: NextRequest) {
  const workspaceId = process.env.DEMO_WORKSPACE_ID;
  const userId = process.env.DEMO_USER_ID;
  if (process.env.DEMO_ENABLED !== 'true' || !workspaceId || !userId) throw AppError.notFound('Demo is not enabled');
  const user = await requireActiveIdentity(userId);
  const { workspace, role } = await resolveAuthorizedWorkspace({ userId, requestedWorkspaceId: workspaceId });
  if (role !== 'uploader' || workspace.settings?.demo !== true) throw AppError.serviceUnavailable('Demo workspace must be explicitly isolated and use an uploader account');
  const token = await createSessionToken({ userId, email: user.email!, name: 'Demo visitor', role, workspaceId, organizationId: workspace.organization_id }, 1800);
  const response = NextResponse.json({ success: true, workspace_id: workspaceId, organization_id: workspace.organization_id, user: { name: 'Demo visitor', role } });
  response.cookies.set({ name: SESSION_COOKIE_NAME, value: token, httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 1800 });
  return response;
}
export const dynamic = 'force-dynamic';
export const POST = withApiRoute(handlePOST);
