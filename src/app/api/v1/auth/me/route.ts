import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/lib/auth/session';
import { workspaceService } from '@/services/workspaceService';
import { mockWorkspace } from '@/lib/mock/store';

export async function GET(req: NextRequest) {
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

  const activeWs = await workspaceService.getWorkspaceById(session.workspaceId || mockWorkspace.id);

  return NextResponse.json({
    success: true,
    data: {
      user: {
        id: session.userId,
        email: session.email,
        name: session.name,
        role: session.role,
      },
      workspace: {
        id: activeWs?.id || mockWorkspace.id,
        name: activeWs?.name || mockWorkspace.name,
        slug: activeWs?.slug || mockWorkspace.slug,
        description: activeWs?.description || null,
        quota_storage_bytes: activeWs?.quota_storage_bytes || mockWorkspace.quota_storage_bytes,
        quota_asset_count: activeWs?.quota_asset_count || mockWorkspace.quota_asset_count,
      },
    },
  });
}
