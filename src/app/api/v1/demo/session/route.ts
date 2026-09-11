import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken, SESSION_COOKIE_NAME, DEMO_USERS } from '@/lib/auth/session';
import { mockWorkspace } from '@/lib/mock/store';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  try {
    let role = 'admin';
    try {
      const body = await req.json();
      if (body?.role && DEMO_USERS[body.role]) {
        role = body.role;
      }
    } catch {
      // Body optional
    }

    const demoUser = DEMO_USERS[role] || DEMO_USERS.admin;
    let workspaceId = mockWorkspace.id;
    let organizationId = 'org_default';

    // If persistent DB, find the real ws_default workspace
    if (isSupabaseAdminConfigured()) {
      const { data: ws } = await supabaseAdmin
        .from('workspaces')
        .select('id, organization_id')
        .or('id.eq.ws_default,slug.eq.default,slug.eq.production')
        .limit(1)
        .maybeSingle();

      if (ws) {
        workspaceId = ws.id;
        organizationId = ws.organization_id;

        // Ensure demo user has active membership in this workspace in PostgreSQL
        const demoUserId = `usr_demo_${role}`;
        await supabaseAdmin.from('workspace_memberships').upsert(
          {
            id: `mem_demo_${role}_${workspaceId}`,
            workspace_id: workspaceId,
            user_id: demoUserId,
            role_id: `role_${role}`,
            status: 'active',
            joined_at: new Date().toISOString(),
          },
          { onConflict: 'workspace_id,user_id' }
        );
      }
    }

    const token = await createSessionToken({
      userId: `usr_demo_${role}`,
      email: demoUser.email,
      name: demoUser.name,
      role: demoUser.role,
      workspaceId,
      organizationId,
    });

    const res = NextResponse.json({
      success: true,
      workspace_id: workspaceId,
      organization_id: organizationId,
      user: {
        name: demoUser.name,
        email: demoUser.email,
        role: demoUser.role,
      },
    });

    res.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: token,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 86400 * 7, // 7 days
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
