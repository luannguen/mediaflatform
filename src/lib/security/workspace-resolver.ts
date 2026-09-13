import { Workspace, WorkspaceMembership } from '@/types/database';
import { UserRole } from '@/lib/auth/session';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabase/admin';
import { mockDb } from '@/lib/mock/store';
import { isPersistentMode, isMockModeAllowed } from '@/lib/platform/persistence-mode';
import { AppError } from '@/lib/errors/app-error';
import { ErrorCodes } from '@/lib/errors/codes';

export interface AuthorizedWorkspaceResolution {
  workspace: Workspace;
  membership: WorkspaceMembership;
  role: UserRole;
  sessionNeedsRefresh?: boolean;
}

export interface WorkspaceResolutionParams {
  userId: string;
  userEmail?: string;
  requestedWorkspaceId?: string;
}

export const ROLE_ID_TO_ROLE: Record<string, UserRole> = {
  role_owner: 'owner',
  role_admin: 'admin',
  role_media_manager: 'media_manager',
  role_editor: 'editor',
  role_uploader: 'uploader',
  role_viewer: 'viewer',
  role_developer: 'developer',
  owner: 'owner',
  admin: 'admin',
  media_manager: 'media_manager',
  editor: 'editor',
  uploader: 'uploader',
  viewer: 'viewer',
  developer: 'developer',
};

export function mapRoleIdToUserRole(roleId: string, explicitRole?: string): UserRole {
  if (explicitRole && ROLE_ID_TO_ROLE[explicitRole]) return ROLE_ID_TO_ROLE[explicitRole];
  return ROLE_ID_TO_ROLE[roleId] || 'viewer';
}

async function loadWorkspaceForMembership(membership: WorkspaceMembership): Promise<AuthorizedWorkspaceResolution | null> {
  const { data: wsRow, error } = await supabaseAdmin
    .from('workspaces')
    .select('*')
    .eq('id', membership.workspace_id)
    .eq('status', 'active')
    .maybeSingle();

  if (error) {
    throw AppError.internal(`Failed to query workspace: ${error.message}`, ErrorCodes.INTERNAL_ERROR);
  }
  if (!wsRow) return null;

  return {
    workspace: wsRow as Workspace,
    membership,
    role: mapRoleIdToUserRole(membership.role_id, membership.role),
    sessionNeedsRefresh: true,
  };
}

function selectionRequired(): never {
  throw AppError.conflict(
    'Multiple active workspaces are available. Select a workspace explicitly before continuing.',
    ErrorCodes.WORKSPACE_SELECTION_REQUIRED
  );
}

/**
 * Runtime workspace authorization is UUID-only.
 * Email is intentionally not an authorization fallback; it is migration/reconciliation data only.
 */
export async function resolveAuthorizedWorkspace(
  params: WorkspaceResolutionParams
): Promise<AuthorizedWorkspaceResolution> {
  const { userId, requestedWorkspaceId } = params;

  if (!userId) {
    throw AppError.unauthorized('User ID is required for workspace authorization', ErrorCodes.AUTH_REQUIRED);
  }

  if (isPersistentMode() && isSupabaseAdminConfigured()) {
    const { data: memberRows, error: memberErr } = await supabaseAdmin
      .from('workspace_memberships')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (memberErr) {
      throw AppError.internal(`Failed to load workspace memberships: ${memberErr.message}`, ErrorCodes.INTERNAL_ERROR);
    }

    const activeMemberships: WorkspaceMembership[] = (memberRows as WorkspaceMembership[]) || [];

    if (requestedWorkspaceId) {
      const matchingMembership = activeMemberships.find((m) => m.workspace_id === requestedWorkspaceId);
      if (matchingMembership) {
        const resolved = await loadWorkspaceForMembership(matchingMembership);
        if (!resolved) {
          throw AppError.forbidden('Workspace is disabled or suspended', ErrorCodes.WORKSPACE_DISABLED);
        }
        resolved.sessionNeedsRefresh = false;
        return resolved;
      }

      const { data: targetWs, error: targetErr } = await supabaseAdmin
        .from('workspaces')
        .select('id')
        .eq('id', requestedWorkspaceId)
        .maybeSingle();

      if (targetErr) {
        throw AppError.internal(`Failed to query requested workspace: ${targetErr.message}`, ErrorCodes.INTERNAL_ERROR);
      }

      if (targetWs) {
        throw AppError.forbidden(
          `You do not have active membership in workspace ${requestedWorkspaceId}`,
          ErrorCodes.WORKSPACE_ACCESS_DENIED
        );
      }

      // Legacy/ghost cookie: heal only when there is exactly one unambiguous membership.
      if (activeMemberships.length === 1) {
        const resolved = await loadWorkspaceForMembership(activeMemberships[0]);
        if (resolved) return resolved;
      }
      if (activeMemberships.length > 1) selectionRequired();

      throw AppError.forbidden(
        'No active workspace membership found for authenticated identity',
        ErrorCodes.WORKSPACE_ACCESS_REQUIRED
      );
    }

    if (activeMemberships.length === 1) {
      const resolved = await loadWorkspaceForMembership(activeMemberships[0]);
      if (resolved) return resolved;
    }
    if (activeMemberships.length > 1) selectionRequired();

    throw AppError.forbidden(
      'No active workspace membership found for authenticated identity',
      ErrorCodes.WORKSPACE_ACCESS_REQUIRED
    );
  }

  if (!isMockModeAllowed()) {
    throw AppError.internal(
      'Persistent database backend is required in production environment. Silent mock fallback is forbidden.',
      ErrorCodes.PERSISTENCE_ERROR
    );
  }

  const mockMemberships = mockDb.workspaceMemberships.filter(
    (m) => m.status === 'active' && m.user_id === userId
  );

  if (requestedWorkspaceId) {
    const match = mockMemberships.find((m) => m.workspace_id === requestedWorkspaceId);
    if (match) {
      const ws = mockDb.workspaces.find((w) => w.id === requestedWorkspaceId && w.status === 'active');
      if (ws) {
        return {
          workspace: ws,
          membership: match,
          role: mapRoleIdToUserRole(match.role_id, match.role),
          sessionNeedsRefresh: false,
        };
      }
    }

    const wsExists = mockDb.workspaces.find((w) => w.id === requestedWorkspaceId);
    if (wsExists) {
      throw AppError.forbidden(
        `You do not have active membership in workspace ${requestedWorkspaceId}`,
        ErrorCodes.WORKSPACE_ACCESS_DENIED
      );
    }

    if (mockMemberships.length === 1) {
      const membership = mockMemberships[0];
      const ws = mockDb.workspaces.find((w) => w.id === membership.workspace_id && w.status === 'active');
      if (ws) {
        return {
          workspace: ws,
          membership,
          role: mapRoleIdToUserRole(membership.role_id, membership.role),
          sessionNeedsRefresh: true,
        };
      }
    }
    if (mockMemberships.length > 1) selectionRequired();
  } else {
    if (mockMemberships.length === 1) {
      const membership = mockMemberships[0];
      const ws = mockDb.workspaces.find((w) => w.id === membership.workspace_id && w.status === 'active');
      if (ws) {
        return {
          workspace: ws,
          membership,
          role: mapRoleIdToUserRole(membership.role_id, membership.role),
          sessionNeedsRefresh: true,
        };
      }
    }
    if (mockMemberships.length > 1) selectionRequired();
  }

  throw AppError.forbidden(
    'No active workspace membership found for authenticated identity',
    ErrorCodes.WORKSPACE_ACCESS_REQUIRED
  );
}
