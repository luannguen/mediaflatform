import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { workspaceService } from '@/services/workspaceService';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabase/admin';
import { supabase, isSupabaseConfigured } from '@/lib/supabase/client';
import { generateId } from '@/lib/ids/generator';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, email, password, workspaceName } = body;

    // 1. Validation
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Full name must be at least 2 characters.',
          },
        },
        { status: 400 }
      );
    }

    const normalizedEmail = (email || '').toLowerCase().trim();
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'A valid email address is required.',
          },
        },
        { status: 400 }
      );
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Password must be at least 8 characters long.',
          },
        },
        { status: 400 }
      );
    }

    let userId = generateId('usr');
    let userName = name.trim();

    // 2. Register user with Supabase Auth (prefer admin.createUser to avoid SMTP rate limits and auto-confirm email)
    if (isSupabaseAdminConfigured()) {
      const { data: adminAuthData, error: adminAuthError } = await supabaseAdmin.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: userName,
          role: 'owner',
        },
      });

      if (adminAuthError) {
        // If user already registered, return conflict
        if (adminAuthError.message?.toLowerCase().includes('already')) {
          return NextResponse.json(
            {
              error: {
                code: 'USER_EXISTS',
                message: 'A user with this email address already exists. Please sign in.',
              },
            },
            { status: 409 }
          );
        }
      } else if (adminAuthData.user) {
        userId = adminAuthData.user.id;
      }
    } else if (isSupabaseConfigured()) {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: {
            full_name: userName,
            role: 'owner',
          },
        },
      });

      if (authError) {
        return NextResponse.json(
          {
            error: {
              code: 'REGISTRATION_FAILED',
              message: authError.message,
            },
          },
          { status: 400 }
        );
      }

      if (authData.user) {
        userId = authData.user.id;
      }
    }

    // 3. Auto-provision dedicated personal workspace for new user
    const personalWorkspace = await workspaceService.createPersonalWorkspaceForUser(
      userId,
      normalizedEmail,
      userName,
      workspaceName
    );

    // 4. Create secure tamper-proof session token
    const token = await createSessionToken({
      userId,
      email: normalizedEmail,
      name: userName,
      role: 'owner',
      workspaceId: personalWorkspace.id,
      organizationId: personalWorkspace.organization_id,
    });

    const response = NextResponse.json(
      {
        success: true,
        data: {
          user: {
            id: userId,
            email: normalizedEmail,
            name: userName,
            role: 'owner',
          },
          workspace: {
            id: personalWorkspace.id,
            name: personalWorkspace.name,
            slug: personalWorkspace.slug,
          },
        },
      },
      { status: 201 }
    );

    // 5. Set HTTP-only session cookie
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
          message: err.message || 'Registration failed',
        },
      },
      { status: 500 }
    );
  }
}
