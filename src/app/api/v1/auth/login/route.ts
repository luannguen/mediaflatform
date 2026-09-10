import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken, DEMO_USERS, SESSION_COOKIE_NAME, UserRole } from '@/lib/auth/session';
import { mockWorkspace } from '@/lib/mock/store';
import { supabase } from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { resolveAuthorizedWorkspace } from '@/lib/security/workspace-resolver';
import { workspaceService } from '@/services/workspaceService';
import { Workspace } from '@/types/database';
import { ErrorCodes } from '@/lib/errors/codes';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password, roleKey } = body;

    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
    const isLocal = process.env.NODE_ENV !== 'production' && (host.includes('localhost') || host.includes('127.0.0.1'));

    let userEmail = email;
    let userName = 'Media Platform User';
    let userRole: UserRole = 'viewer';
    let userId = `usr_${Date.now().toString(36)}`;

    // 1. Quick demo sign-in by role (RESTRICTED TO LOCALHOST ONLY)
    if (roleKey) {
      if (!isLocal) {
        return NextResponse.json(
          {
            error: {
              code: 'FORBIDDEN',
              message: 'Quick Sign-in (RBAC Simulator) is strictly restricted to localhost:3000 development environments.',
            },
          },
          { status: 403 }
        );
      }

      if (!DEMO_USERS[roleKey]) {
        return NextResponse.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: `Unknown role key: ${roleKey}`,
            },
          },
          { status: 400 }
        );
      }

      const demo = DEMO_USERS[roleKey];
      userEmail = demo.email;
      userName = demo.name;
      userRole = demo.role;
      userId = `usr_demo_${roleKey}`;
    } else if (email) {
      const envAdminEmail = process.env.ADMIN_EMAIL ? process.env.ADMIN_EMAIL.replace(/"/g, '').trim() : '';
      const envAdminPassword = process.env.ADMIN_PASSWORD ? process.env.ADMIN_PASSWORD.replace(/"/g, '').trim() : '';
      const envAdminName = process.env.ADMIN_NAME ? process.env.ADMIN_NAME.replace(/"/g, '').trim() : 'Super Admin (Owner)';

      // 2. Direct check for configured Super Admin Account from environment
      const isSuperAdminMatch =
        Boolean(envAdminEmail && envAdminPassword) &&
        email.toLowerCase().trim() === envAdminEmail.toLowerCase().trim() &&
        password === envAdminPassword;

      if (isSuperAdminMatch) {
        userId = 'usr_super_admin_configured';
        userEmail = envAdminEmail;
        userName = envAdminName;
        userRole = 'owner';
      } else if (isSupabaseConfigured() && password) {
        // 3. Authenticate with Supabase Auth
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          return NextResponse.json(
            {
              error: {
                code: 'INVALID_CREDENTIALS',
                message: error.message || 'Invalid email or password',
              },
            },
            { status: 401 }
          );
        }

        if (data.user) {
          userId = data.user.id;
          userEmail = data.user.email || email;
          userName = data.user.user_metadata?.full_name || email.split('@')[0];
          userRole = (data.user.user_metadata?.role as UserRole) || 'admin';
        }
      } else {
        return NextResponse.json(
          {
            error: {
              code: 'INVALID_CREDENTIALS',
              message: 'Invalid email or password',
            },
          },
          { status: 401 }
        );
      }
    } else {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Email and password are required',
          },
        },
        { status: 400 }
      );
    }

    // Resolve active authorized workspace from PostgreSQL
    let activeWorkspace: Workspace;
    let activeRole: UserRole = userRole;

    try {
      const resolved = await resolveAuthorizedWorkspace({
        userId,
        userEmail,
      });
      activeWorkspace = resolved.workspace;
      activeRole = resolved.role;
    } catch (authErr: any) {
      if (authErr.code === ErrorCodes.WORKSPACE_ACCESS_REQUIRED) {
        // Safe auto-provisioning of dedicated personal workspace for authenticated legacy orphan user
        const newWs = await workspaceService.createPersonalWorkspaceForUser(
          userId,
          userEmail,
          userName
        );
        activeWorkspace = newWs;
        activeRole = 'owner';
      } else {
        throw authErr;
      }
    }

    const token = await createSessionToken({
      userId,
      email: userEmail,
      name: userName,
      role: activeRole,
      workspaceId: activeWorkspace.id,
      organizationId: activeWorkspace.organization_id,
    });

    const response = NextResponse.json({
      success: true,
      data: {
        user: {
          id: userId,
          email: userEmail,
          name: userName,
          role: activeRole,
        },
        workspace: {
          id: activeWorkspace.id,
          name: activeWorkspace.name,
          slug: activeWorkspace.slug,
        },
      },
    });

    // Set HTTP-only session cookie
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return response;
  } catch (err: any) {
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: err.message || 'Login failed',
        },
      },
      { status: 500 }
    );
  }
}
