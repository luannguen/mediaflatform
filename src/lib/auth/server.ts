import { createClient, User } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { AppError } from '@/lib/errors/app-error';
import { resolveAuthorizedWorkspace } from '@/lib/security/workspace-resolver';
import { workspaceService } from '@/services/workspaceService';
import { createSessionToken, SESSION_COOKIE_NAME } from './session';

/** Auth clients must never share mutable sessions between server requests. */
export function createAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw AppError.serviceUnavailable('Authentication is not configured');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: {
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }),
  } });
}

export async function requireActiveIdentity(id: string): Promise<User> {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) throw AppError.unauthorized('Please sign in again');
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(id);
  if (error && error.status !== 404 && error.status !== 422) throw AppError.serviceUnavailable('Identity service is unavailable');
  const user = data?.user;
  if (!user?.email_confirmed_at || (user.banned_until && new Date(user.banned_until).getTime() > Date.now())) throw AppError.unauthorized('Please sign in with an active, verified account');
  return user;
}

export async function issueUserSession(user: User, workspaceId?: string, workspaceName?: string) {
  if (!user.email || !user.email_confirmed_at) throw AppError.unauthorized('Confirm your email before signing in');
  const name = String(user.user_metadata?.full_name || user.email.split('@')[0]).slice(0,100);
  let resolved;
  try { resolved = await resolveAuthorizedWorkspace({ userId: user.id, requestedWorkspaceId: workspaceId }); }
  catch (error) {
    if (error instanceof AppError && error.code === 'WORKSPACE_SELECTION_REQUIRED') {
      const workspaces = await workspaceService.getUserWorkspaces(user.id, user.email);
      return NextResponse.json({ success: false, error: { code: error.code, message: error.message, details: { workspaces } } }, { status: 409 });
    }
    if (!(error instanceof AppError) || error.code !== 'WORKSPACE_ACCESS_REQUIRED' || workspaceId) throw error;
    await workspaceService.createPersonalWorkspaceForUser(user.id, user.email, name, workspaceName || user.user_metadata?.workspace_name);
    resolved = await resolveAuthorizedWorkspace({ userId: user.id });
  }
  const { workspace, role } = resolved;
  const token = await createSessionToken({ userId: user.id, email: user.email, name, role, workspaceId: workspace.id, organizationId: workspace.organization_id });
  const response = NextResponse.json({ success: true, data: { user: { id: user.id, email: user.email, name, role }, workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug } } });
  response.cookies.set({ name: SESSION_COOKIE_NAME, value: token, httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 604800 });
  return response;
}
