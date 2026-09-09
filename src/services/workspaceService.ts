import { Workspace, WorkspaceMembership, Folder } from '@/types/database';
import { mockDb, mockWorkspace } from '@/lib/mock/store';
import { generateId } from '@/lib/ids/generator';
import { AppError } from '@/lib/errors/app-error';
import { ErrorCodes } from '@/lib/errors/codes';
import { UserRole } from '@/lib/auth/session';

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
   * Get all workspaces the user has an active membership in
   */
  async getUserWorkspaces(userId: string, userEmail?: string): Promise<UserWorkspaceSummary[]> {
    // If user is super admin, ensure they have membership to ws_default and ws_personal_admin
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
          role: (mem.role as UserRole) || 'viewer',
          quota_storage_bytes: ws.quota_storage_bytes,
          quota_asset_count: ws.quota_asset_count,
          created_at: ws.created_at,
        });
      }
    }

    // Fallback: If no workspaces found (e.g. demo users), give access to mockWorkspace
    if (summaries.length === 0) {
      summaries.push({
        id: mockWorkspace.id,
        name: mockWorkspace.name,
        slug: mockWorkspace.slug,
        description: mockWorkspace.description,
        role: 'viewer',
        quota_storage_bytes: mockWorkspace.quota_storage_bytes,
        quota_asset_count: mockWorkspace.quota_asset_count,
        created_at: mockWorkspace.created_at,
      });
    }

    return summaries;
  },

  /**
   * Retrieve workspace details by ID
   */
  async getWorkspaceById(workspaceId: string): Promise<Workspace | null> {
    const ws = mockDb.workspaces.find((w) => w.id === workspaceId);
    return ws || (workspaceId === mockWorkspace.id ? mockWorkspace : null);
  },

  /**
   * Get member's role in a specific workspace
   */
  async getUserRoleInWorkspace(userId: string, workspaceId: string, userEmail?: string): Promise<UserRole | null> {
    const mem = mockDb.workspaceMemberships.find(
      (m) =>
        m.workspace_id === workspaceId &&
        m.status === 'active' &&
        (m.user_id === userId || (userEmail && m.user_email?.toLowerCase() === userEmail.toLowerCase()))
    );

    return (mem?.role as UserRole) || null;
  },

  /**
   * Create a new workspace for an authenticated user
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
    const orgId = generateId('org');
    const slug = input.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || `ws-${Date.now().toString(36)}`;
    const now = new Date().toISOString();

    const newWs: Workspace = {
      id: wsId,
      organization_id: orgId,
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
      quota_storage_bytes: 10 * 1024 * 1024 * 1024, // 10 GB
      quota_asset_count: 50000,
      created_at: now,
      updated_at: now,
    };

    mockDb.workspaces.push(newWs);

    // Add owner membership for the creator
    const membership: WorkspaceMembership = {
      id: generateId('mem'),
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

    // Auto-create initial default folder
    const folderId = generateId('fld');
    const folder: Folder = {
      id: folderId,
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
   * Auto-provision a personal workspace when a completely new user registers
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
   * Get all active members of a workspace
   */
  async getWorkspaceMembers(workspaceId: string): Promise<WorkspaceMembership[]> {
    return mockDb.workspaceMemberships.filter(
      (m) => m.workspace_id === workspaceId && m.status === 'active'
    );
  },
};
