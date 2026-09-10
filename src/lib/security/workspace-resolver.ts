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

/**
 * Standard mapping from DB role_id to canonical UserRole
 */
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
  if (explicitRole && ROLE_ID_TO_ROLE[explicitRole]) {
    return ROLE_ID_TO_ROLE[explicitRole];
  }
  return ROLE_ID_TO_ROLE[roleId] || 'viewer';
}

/**
 * Central Authorization Resolver
 * Strictly enforces tenant isolation:
 * 1. Checks PostgreSQL workspace_memberships as authoritative source of truth.
 * 2. Authenticates that user actually has an ACTIVE membership in the target workspace.
 * 3. Never falls back to ws_default automatically.
 * 4. Resolves ghost workspace IDs to the user's real personal workspace if exactly one exists.
 * 5. Rejects cross-tenant access with 403 WORKSPACE_ACCESS_DENIED.
 */
export async function resolveAuthorizedWorkspace(
  params: WorkspaceResolutionParams
): Promise<AuthorizedWorkspaceResolution> {
  const { userId, userEmail, requestedWorkspaceId } = params;

  if (!userId) {
    throw AppError.unauthorized('User ID is required for workspace authorization', ErrorCodes.AUTH_REQUIRED);
  }

  // 1. Production / Persistent Mode via PostgreSQL
  if (isPersistentMode() && isSupabaseAdminConfigured()) {
    // Query active memberships for this user
    let membershipQuery = supabaseAdmin
      .from('workspace_memberships')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active');

    const { data: memberRows, error: memberErr } = await membershipQuery;

    if (memberErr) {
      throw AppError.internal(`Failed to load workspace memberships: ${memberErr.message}`, ErrorCodes.INTERNAL_ERROR);
    }

    let activeMemberships: WorkspaceMembership[] = (memberRows as WorkspaceMembership[]) || [];

    // Legacy fallback: if no memberships by user_id, check by email if provided
    if (activeMemberships.length === 0 && userEmail) {
      const { data: emailRows } = await supabaseAdmin
        .from('workspace_memberships')
        .select('*')
        .eq('user_email', userEmail.toLowerCase().trim())
        .eq('status', 'active');
      if (emailRows && emailRows.length > 0) {
        activeMemberships = emailRows as WorkspaceMembership[];
      }
    }

    // CASE A: requestedWorkspaceId is provided
    if (requestedWorkspaceId) {
      // First, check if user has active membership in the requested workspace
      const matchingMembership = activeMemberships.find((m) => m.workspace_id === requestedWorkspaceId);

      if (matchingMembership) {
        // Verify the workspace itself exists and is active
        const { data: wsRow, error: wsErr } = await supabaseAdmin
          .from('workspaces')
          .select('*')
          .eq('id', requestedWorkspaceId)
          .eq('status', 'active')
          .maybeSingle();

        if (wsErr) {
          throw AppError.internal(`Failed to query workspace: ${wsErr.message}`, ErrorCodes.INTERNAL_ERROR);
        }

        if (wsRow) {
          const role = mapRoleIdToUserRole(matchingMembership.role_id, matchingMembership.role);
          return {
            workspace: wsRow as Workspace,
            membership: matchingMembership,
            role,
            sessionNeedsRefresh: false,
          };
        } else {
          // Workspace is disabled or suspended
          throw AppError.forbidden('Workspace is disabled or suspended', ErrorCodes.WORKSPACE_DISABLED);
        }
      }

      // Check if requested workspace genuinely exists in database
      const { data: targetWs } = await supabaseAdmin
        .from('workspaces')
        .select('id')
        .eq('id', requestedWorkspaceId)
        .maybeSingle();

      if (targetWs) {
        // Workspace exists, but current user is NOT an active member!
        // Cross-tenant breach attempt -> strict 403
        throw AppError.forbidden(
          `You do not have active membership in workspace ${requestedWorkspaceId}`,
          ErrorCodes.WORKSPACE_ACCESS_DENIED
        );
      }

      // requestedWorkspaceId does NOT exist in DB (Ghost workspace from legacy cookie)
      // Attempt self-healing only if user has an active membership
      if (activeMemberships.length === 1) {
        const singleMem = activeMemberships[0];
        const { data: wsRow } = await supabaseAdmin
          .from('workspaces')
          .select('*')
          .eq('id', singleMem.workspace_id)
          .eq('status', 'active')
          .maybeSingle();

        if (wsRow) {
          const role = mapRoleIdToUserRole(singleMem.role_id, singleMem.role);
          return {
            workspace: wsRow as Workspace,
            membership: singleMem,
            role,
            sessionNeedsRefresh: true, // Marker: cookie contains ghost ID and needs update
          };
        }
      } else if (activeMemberships.length > 1) {
        // Deterministic primary workspace: pick earliest joined workspace
        const sorted = [...activeMemberships].sort(
          (a, b) => new Date(a.joined_at || a.created_at).getTime() - new Date(b.joined_at || b.created_at).getTime()
        );
        const primaryMem = sorted[0];
        const { data: wsRow } = await supabaseAdmin
          .from('workspaces')
          .select('*')
          .eq('id', primaryMem.workspace_id)
          .eq('status', 'active')
          .maybeSingle();

        if (wsRow) {
          const role = mapRoleIdToUserRole(primaryMem.role_id, primaryMem.role);
          return {
            workspace: wsRow as Workspace,
            membership: primaryMem,
            role,
            sessionNeedsRefresh: true,
          };
        }
      }

      // User has 0 active memberships: STRICTLY DO NOT FALLBACK TO ws_default!
      throw AppError.forbidden(
        'No active workspace membership found for authenticated identity',
        ErrorCodes.WORKSPACE_ACCESS_REQUIRED
      );
    }

    // CASE B: requestedWorkspaceId is missing / undefined
    if (activeMemberships.length === 1) {
      const singleMem = activeMemberships[0];
      const { data: wsRow } = await supabaseAdmin
        .from('workspaces')
        .select('*')
        .eq('id', singleMem.workspace_id)
        .eq('status', 'active')
        .maybeSingle();

      if (wsRow) {
        const role = mapRoleIdToUserRole(singleMem.role_id, singleMem.role);
        return {
          workspace: wsRow as Workspace,
          membership: singleMem,
          role,
          sessionNeedsRefresh: true,
        };
      }
    } else if (activeMemberships.length > 1) {
      // Deterministic primary workspace
      const sorted = [...activeMemberships].sort(
        (a, b) => new Date(a.joined_at || a.created_at).getTime() - new Date(b.joined_at || b.created_at).getTime()
      );
      const primaryMem = sorted[0];
      const { data: wsRow } = await supabaseAdmin
        .from('workspaces')
        .select('*')
        .eq('id', primaryMem.workspace_id)
        .eq('status', 'active')
        .maybeSingle();

      if (wsRow) {
        const role = mapRoleIdToUserRole(primaryMem.role_id, primaryMem.role);
        return {
          workspace: wsRow as Workspace,
          membership: primaryMem,
          role,
          sessionNeedsRefresh: true,
        };
      }
    }

    // Zero active memberships: DO NOT fallback to ws_default
    throw AppError.forbidden(
      'No active workspace membership found for authenticated identity',
      ErrorCodes.WORKSPACE_ACCESS_REQUIRED
    );
  }

  // 2. Mock Mode (strictly restricted to offline development/testing)
  if (!isMockModeAllowed()) {
    throw AppError.internal(
      'Persistent database backend is required in production environment. Silent mock fallback is forbidden.',
      ErrorCodes.PERSISTENCE_ERROR
    );
  }

  const mockMemberships = mockDb.workspaceMemberships.filter(
    (m) =>
      m.status === 'active' &&
      (m.user_id === userId || (userEmail && m.user_email?.toLowerCase() === userEmail.toLowerCase()))
  );

  if (requestedWorkspaceId) {
    const match = mockMemberships.find((m) => m.workspace_id === requestedWorkspaceId);
    if (match) {
      const ws = mockDb.workspaces.find((w) => w.id === requestedWorkspaceId && w.status === 'active');
      if (ws) {
        const role = mapRoleIdToUserRole(match.role_id, match.role);
        return { workspace: ws, membership: match, role, sessionNeedsRefresh: false };
      }
    }

    const wsExists = mockDb.workspaces.find((w) => w.id === requestedWorkspaceId);
    if (wsExists) {
      throw AppError.forbidden(
        `You do not have active membership in workspace ${requestedWorkspaceId}`,
        ErrorCodes.WORKSPACE_ACCESS_DENIED
      );
    }

    // Ghost ID heal in mock mode
    if (mockMemberships.length > 0) {
      const primary = mockMemberships[0];
      const ws = mockDb.workspaces.find((w) => w.id === primary.workspace_id);
      if (ws) {
        const role = mapRoleIdToUserRole(primary.role_id, primary.role);
        return { workspace: ws, membership: primary, role, sessionNeedsRefresh: true };
      }
    }
  } else if (mockMemberships.length > 0) {
    const primary = mockMemberships[0];
    const ws = mockDb.workspaces.find((w) => w.id === primary.workspace_id);
    if (ws) {
      const role = mapRoleIdToUserRole(primary.role_id, primary.role);
      return { workspace: ws, membership: primary, role, sessionNeedsRefresh: true };
    }
  }

  throw AppError.forbidden(
    'No active workspace membership found for authenticated identity',
    ErrorCodes.WORKSPACE_ACCESS_REQUIRED
  );
}
