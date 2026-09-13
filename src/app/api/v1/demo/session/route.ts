import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { mockWorkspace } from '@/lib/mock/store';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';

const DEMO_USER_ID = 'usr_demo_public';
const DEMO_ROLE = 'uploader' as const;
const DEMO_ROLE_ID = 'role_uploader';
const DEMO_EMAIL = 'demo@media-platform.local';
const DEMO_NAME = 'Media Platform Public Demo';
const DEMO_COOKIE_TTL_SECONDS = Number(process.env.DEMO_SESSION_TTL_SECONDS || 3600);

/**
 * Public demo broker.
 * The browser cannot choose workspace, principal, role, scopes, or quota.
 * The demo principal is intentionally non-admin and fixed server-side.
 */
export async function POST(_req: NextRequest) {
  try {
    let workspaceId = mockWorkspace.id;
    let organizationId = 'org_default';

    if (isSupabaseAdminConfigured()) {
      const { data: ws, error: wsError } = await supabaseAdmin
        .from('workspaces')
        .select('id, organization_id')
        .or('id.eq.ws_default,slug.eq.default,slug.eq.production')
        .limit(1)
        .maybeSingle();

      if (wsError) {
        throw new Error(`Failed to resolve demo workspace: ${wsError.message}`);
      }
      if (!ws) {
        throw new Error('Demo workspace is not configured');
      }

      workspaceId = ws.id;
      organizationId = ws.organization_id;

      const { error: membershipError } = await supabaseAdmin.from('workspace_memberships').upsert(
        {
          id: `mem_demo_public_${workspaceId}`,
          workspace_id: workspaceId,
          user_id: DEMO_USER_ID,
          user_email: DEMO_EMAIL,
          role_id: DEMO_ROLE_ID,
          role: DEMO_ROLE,
          status: 'active',
          joined_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_id,user_id' }
      );

      if (membershipError) {
        throw new Error(`Failed to provision demo membership: ${membershipError.message}`);
      }
    }

    const token = await createSessionToken({
      userId: DEMO_USER_ID,
      email: DEMO_EMAIL,
      name: DEMO_NAME,
      role: DEMO_ROLE,
      workspaceId,
      organizationId,
    });

    const res = NextResponse.json({
      success: true,
      workspace_id: workspaceId,
      organization_id: organizationId,
      user: {
        name: DEMO_NAME,
        email: DEMO_EMAIL,
        role: DEMO_ROLE,
      },
    });

    res.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: token,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: Math.max(300, Math.min(DEMO_COOKIE_TTL_SECONDS, 7200)),
    });

    return res;
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to establish demo session' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
