import { NextRequest, NextResponse } from 'next/server';
import { withApiRoute } from '@/lib/platform/apiRoute';
import { createAuthClient, issueUserSession } from '@/lib/auth/server';
import { AppError } from '@/lib/errors/app-error';
import { z } from 'zod';

const registration = z.object({ name: z.string().trim().min(2).max(100), email: z.string().trim().email().max(254), password: z.string().min(12).max(1024), workspaceName: z.string().trim().min(2).max(100).optional() });
async function handlePOST(req: NextRequest) {
  const parsed = registration.safeParse(await req.json());
  if (!parsed.success) throw AppError.badRequest('Use a valid email, name, and a password of at least 12 characters', undefined, parsed.error.flatten());
  const { name, email, password, workspaceName } = parsed.data;
  const { data, error } = await createAuthClient().auth.signUp({ email, password, options: { data: { full_name: name, workspace_name: workspaceName } } });
  if (error) throw new AppError('Registration could not be completed. Try again later or sign in to an existing account.', 'VALIDATION_ERROR', error.status === 429 ? 429 : 400);
  if (!data.user || !data.session || !data.user.email_confirmed_at) return NextResponse.json({ success: true, data: { requires_confirmation: true, message: 'Check your email to confirm your account, then sign in.' } }, { status: 202 });
  return issueUserSession(data.user, undefined, workspaceName);
}
export const dynamic = 'force-dynamic';
export const POST = withApiRoute(handlePOST);
