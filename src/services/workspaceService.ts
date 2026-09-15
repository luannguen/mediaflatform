import { Workspace, WorkspaceMembership, Folder } from '@/types/database';
import { mockDb, mockWorkspace } from '@/lib/mock/store';
import { generateId } from '@/lib/ids/generator';
import { AppError } from '@/lib/errors/app-error';
import { ErrorCodes } from '@/lib/errors/codes';
import { UserRole } from '@/lib/auth/session';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabase/admin';
import { isPersistentMode, isMockModeAllowed } from '@/lib/platform/persistence-mode';
import { mapRoleIdToUserRole } from '@/lib/security/workspace-resolver';

export interface UserWorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  role: UserRole;
  quota_storage_bytes: number;
  quota_asset_count: number;
  created_at: string;
}

export const workspaceService = {
  /**
   * Get all workspaces the user has an active membership in.
   * Persistent in PostgreSQL: Never synthesizes or defaults to ws_default.
   */
  async getUserWorkspaces(userId: string, userEmail?: string): Promise<UserWorkspaceSummary[]> {
    if (isPersistentMode() && isSupabaseAdminConfigured()) {
      let query = supabaseAdmin
        .from('workspace_memberships')
        .select('workspace_id, role_id, status, joined_at, created_at')
        .eq('user_id', userId)
        .eq('status', 'active');

      const { data: mems, error: memErr } = await query;
      if (memErr) {
        throw AppError.internal(`Failed to load user workspace memberships: ${memErr.message}`, ErrorCodes.INTERNAL_ERROR);
      }

      let activeMemberships = mems || [];

      // Legacy fallback by email if no memberships found by user_id
      if (activeMemberships.length === 0 && userEmail) {
        const { data: emailMems } = await supabaseAdmin
          .from('workspace_memberships')
          .select('workspace_id, role_id, status, joined_at, created_at')
          .eq('user_email', userEmail.toLowerCase().trim())
          .eq('status', 'active');
        if (emailMems && emailMems.length > 0) {
          activeMemberships = emailMems;
        }
      }

      if (activeMemberships.length === 0) {
        return [];
      }

      const wsIds = activeMemberships.map((m) => m.workspace_id);
      const { data: wsRows, error: wsErr } = await supabaseAdmin
        .from('workspaces')
        .select('*')
        .in('id', wsIds)
        .eq('status', 'active');

      if (wsErr) {
        throw AppError.internal(`Failed to load workspaces: ${wsErr.message}`, ErrorCodes.INTERNAL_ERROR);
      }

      const summaries: UserWorkspaceSummary[] = [];
      for (const mem of activeMemberships) {
        const ws = (wsRows || []).find((w) => w.id === mem.workspace_id);
        if (ws) {
          summaries.push({
            id: ws.id,
            name: ws.name,
            slug: ws.slug,
            description: ws.description,
            role: mapRoleIdToUserRole(mem.role_id),
            quota_storage_bytes: Number(ws.quota_storage_bytes) || 10737418240,
            quota_asset_count: Number(ws.quota_asset_count) || 50000,
            created_at: ws.created_at,
          });
        }
      }

      return summaries;
    }

    // Mock Mode fallback (offline testing only)
    if (!isMockModeAllowed()) {
      throw AppError.internal(
        'Persistent database backend is required in production environment. Silent mock fallback is forbidden.',
        ErrorCodes.PERSISTENCE_ERROR
      );
    }

    const memberships = mockDb.workspaceMemberships.filter(
      (m) =>
        m.status === 'active' &&
        (m.user_id === userId || (userEmail && m.user_email?.toLowerCase() === userEmail.toLowerCase()))
    );

    const summaries: UserWorkspaceSummary[] = [];
    for (const mem of memberships) {
      const ws = mockDb.workspaces.find((w) => w.id === mem.workspace_id);
      if (ws) {
        summaries.push({
          id: ws.id,
          name: ws.name,
          slug: ws.slug,
          description: ws.description,
          role: mapRoleIdToUserRole(mem.role_id, mem.role),
          quota_storage_bytes: ws.quota_storage_bytes,
          quota_asset_count: ws.quota_asset_count,
          created_at: ws.created_at,
        });
      }
    }

    return summaries;
  },

  /**
   * Retrieve workspace details by ID from PostgreSQL.
   * Returns null only when the workspace genuinely doesn't exist.
   * Does NOT substitute mockWorkspace in production.
   */
  async getWorkspaceById(workspaceId: string): Promise<Workspace | null> {
    if (isPersistentMode() && isSupabaseAdminConfigured()) {
      const { data, error } = await supabaseAdmin
        .from('workspaces')
        .select('*')
        .eq('id', workspaceId)
        .eq('status', 'active')
        .maybeSingle();

      if (error) {
        throw AppError.internal(`Failed to fetch workspace ${workspaceId}: ${error.message}`, ErrorCodes.INTERNAL_ERROR);
      }

      return (data as Workspace) || null;
    }

    if (!isMockModeAllowed()) {
      throw AppError.internal(
        'Persistent database backend is required in production environment. Silent mock fallback is forbidden.',
        ErrorCodes.PERSISTENCE_ERROR
      );
    }

    const ws = mockDb.workspaces.find((w) => w.id === workspaceId);
    return ws || (workspaceId === mockWorkspace.id ? mockWorkspace : null);
  },

  /**
   * Get member's role in a specific workspace from PostgreSQL.
   */
  async getUserRoleInWorkspace(userId: string, workspaceId: string, userEmail?: string): Promise<UserRole | null> {
    if (isPersistentMode() && isSupabaseAdminConfigured()) {
      let query = supabaseAdmin
        .from('workspace_memberships')
        .select('role_id, status')
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle();

      const { data, error } = await query;
      if (error) {
        throw AppError.internal(`Failed to check user role in workspace: ${error.message}`, ErrorCodes.INTERNAL_ERROR);
      }

      if (data) {
        return mapRoleIdToUserRole(data.role_id);
      }

      // Legacy fallback by email
      if (userEmail) {
        const { data: emailData } = await supabaseAdmin
          .from('workspace_memberships')
          .select('role_id, status')
          .eq('workspace_id', workspaceId)
          .eq('user_email', userEmail.toLowerCase().trim())
          .eq('status', 'active')
          .maybeSingle();
        if (emailData) {
          return mapRoleIdToUserRole(emailData.role_id);
        }
      }

      return null;
    }

    if (!isMockModeAllowed()) {
      throw AppError.internal(
        'Persistent database backend is required in production environment. Silent mock fallback is forbidden.',
        ErrorCodes.PERSISTENCE_ERROR
      );
    }

    const mem = mockDb.workspaceMemberships.find(
      (m) =>
        m.workspace_id === workspaceId &&
        m.status === 'active' &&
        (m.user_id === userId || (userEmail && m.user_email?.toLowerCase() === userEmail.toLowerCase()))
    );

    return mem ? mapRoleIdToUserRole(mem.role_id, mem.role) : null;
  },

  /**
   * Create a new workspace for an authenticated user.
   * Atomically executes via PostgreSQL stored procedure provision_workspace_for_user.
   */
  async createWorkspace(
    userId: string,
    input: {
      name: string;
      description?: string;
      userEmail?: string;
      userName?: string;
    }
  ): Promise<Workspace> {
    if (!input.name || !input.name.trim()) {
      throw AppError.badRequest('Workspace name is required', ErrorCodes.VALIDATION_ERROR);
    }

    const wsId = generateId('ws');
    const memId = generateId('mem');
    const fldId = generateId('fld');
    const slug =
      input.name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || `ws-${Date.now().toString(36)}`;
    const now = new Date().toISOString();

    if (isPersistentMode() && isSupabaseAdminConfigured()) {
      const { data, error } = await supabaseAdmin.rpc('provision_workspace_for_user', {
        p_workspace_id: wsId,
        p_organization_id: 'org_default',
        p_workspace_name: input.name.trim(),
        p_workspace_slug: slug,
        p_description: input.description?.trim() || null,
        p_user_id: userId,
        p_user_email: input.userEmail || null,
        p_user_name: input.userName || null,
        p_membership_id: memId,
        p_folder_id: fldId,
      });

      if (error) {
        throw AppError.internal(
          `Failed to provision workspace atomically in PostgreSQL: ${error.message}`,
          ErrorCodes.WORKSPACE_PROVISIONING_FAILED
        );
      }

      if (!data) {
        throw AppError.internal(
          'Workspace provisioning returned empty record from PostgreSQL',
          ErrorCodes.WORKSPACE_PROVISIONING_FAILED
        );
      }

      return data as Workspace;
    }

    if (!isMockModeAllowed()) {
      throw AppError.internal(
        'Persistent database backend is required in production environment. Silent mock fallback is forbidden.',
        ErrorCodes.PERSISTENCE_ERROR
      );
    }

    const newWs: Workspace = {
      id: wsId,
      organization_id: 'org_default',
      name: input.name.trim(),
      slug,
      description: input.description?.trim() || null,
      status: 'active',
      default_visibility: 'workspace',
      storage_policy: 'standard',
      retention_policy: {
        trash_retention_days: 30,
        unused_asset_retention_days: 90,
      },
      quota_storage_bytes: 10 * 1024 * 1024 * 1024,
      quota_asset_count: 50000,
      created_at: now,
      updated_at: now,
    };

    mockDb.workspaces.push(newWs);

    const membership: WorkspaceMembership = {
      id: memId,
      workspace_id: wsId,
      user_id: userId,
      user_email: input.userEmail,
      user_name: input.userName,
      role_id: 'role_owner',
      role: 'owner',
      status: 'active',
      joined_at: now,
      created_at: now,
      updated_at: now,
    };

    mockDb.workspaceMemberships.push(membership);

    const folder: Folder = {
      id: fldId,
      workspace_id: wsId,
      name: 'General Media',
      slug: 'general-media',
      description: 'Default upload folder',
      created_at: now,
      updated_at: now,
    };
    mockDb.folders.push(folder);

    return newWs;
  },

  /**
   * Auto-provision a personal workspace when a new user registers or legacy orphan user logs in.
   */
  async createPersonalWorkspaceForUser(
    userId: string,
    email: string,
    name: string,
    customWorkspaceName?: string
  ): Promise<Workspace> {
    const defaultWsName = customWorkspaceName?.trim() || `${name}'s Workspace`;
    return this.createWorkspace(userId, {
      name: defaultWsName,
      description: `Personal workspace for ${name}`,
      userEmail: email,
      userName: name,
    });
  },

  /**
   * Get all active members of a workspace from PostgreSQL.
   */
  async getWorkspaceMembers(workspaceId: string): Promise<WorkspaceMembership[]> {
    if (isPersistentMode() && isSupabaseAdminConfigured()) {
      const { data, error } = await supabaseAdmin.rpc('workspace_member_directory', { p_workspace: workspaceId });

      if (error) {
        throw AppError.internal(`Failed to load workspace members: ${error.message}`, ErrorCodes.INTERNAL_ERROR);
      }

      return (data as WorkspaceMembership[]) || [];
    }

    if (!isMockModeAllowed()) {
      throw AppError.internal(
        'Persistent database backend is required in production environment. Silent mock fallback is forbidden.',
        ErrorCodes.PERSISTENCE_ERROR
      );
    }

    return mockDb.workspaceMemberships.filter(
      (m) => m.workspace_id === workspaceId && m.status === 'active'
    );
  },
};
