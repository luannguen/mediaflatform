import { NextRequest } from 'next/server';
import { withApiRoute } from '@/lib/platform/apiRoute';
import { createAuthClient, issueUserSession } from '@/lib/auth/server';
import { AppError } from '@/lib/errors/app-error';

async function handlePOST(req: NextRequest) {
  const { email, password, workspaceId, roleKey } = await req.json();
  if (roleKey) throw AppError.forbidden('Role simulation is not a sign-in method');
  if (typeof email !== 'string' || email.length > 254 || typeof password !== 'string' || !password || password.length > 1024 || workspaceId != null && (typeof workspaceId !== 'string' || workspaceId.length > 128)) throw AppError.badRequest('Valid email and password are required');
  const { data, error } = await createAuthClient().auth.signInWithPassword({ email: email.trim(), password });
  if (error || !data.user || !data.session) throw AppError.unauthorized('Invalid email or password, or email not yet confirmed');
  return issueUserSession(data.user, workspaceId);
}
export const dynamic = 'force-dynamic';
export const POST = withApiRoute(handlePOST);
