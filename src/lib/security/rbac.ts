import { AuthPrincipal } from './auth-guard';
import { AppError } from '../errors/app-error';
import { ErrorCodes } from '../errors/codes';

/**
 * Standard Permission Action Keys (Section 10)
 */
export const Permissions = {
  // Asset
  ASSET_READ: 'asset.read',
  ASSET_CREATE: 'asset.create',
  ASSET_UPDATE: 'asset.update',
  ASSET_DELETE: 'asset.delete',
  ASSET_RESTORE: 'asset.restore',
  ASSET_PURGE: 'asset.purge',

  // Folder
  FOLDER_READ: 'folder.read',
  FOLDER_CREATE: 'folder.create',
  FOLDER_UPDATE: 'folder.update',
  FOLDER_DELETE: 'folder.delete',

  // Collection
  COLLECTION_READ: 'collection.read',
  COLLECTION_CREATE: 'collection.create',
  COLLECTION_UPDATE: 'collection.update',
  COLLECTION_DELETE: 'collection.delete',

  // Members & Roles
  MEMBER_READ: 'member.read',
  MEMBER_INVITE: 'member.invite',
  MEMBER_UPDATE: 'member.update',
  MEMBER_REMOVE: 'member.remove',
  ROLE_READ: 'role.read',
  ROLE_MANAGE: 'role.manage',

  // Developer & Integrations
  APPLICATION_READ: 'application.read',
  APPLICATION_MANAGE: 'application.manage',
  APIKEY_READ: 'apikey.read',
  APIKEY_CREATE: 'apikey.create',
  APIKEY_REVOKE: 'apikey.revoke',
  WEBHOOK_READ: 'webhook.read',
  WEBHOOK_MANAGE: 'webhook.manage',

  // Telemetry & Workspace
  AUDIT_READ: 'audit.read',
  USAGE_READ: 'usage.read',
  WORKSPACE_READ: 'workspace.read',
  WORKSPACE_MANAGE: 'workspace.manage',
} as const;

export type PermissionAction = (typeof Permissions)[keyof typeof Permissions] | string;

/**
 * Mapping between API Key Scopes (e.g. "assets:read") and RBAC Permissions (e.g. "asset.read")
 */
const SCOPE_TO_PERMISSION_MAP: Record<string, string[]> = {
  'assets:read': ['asset.read', 'folder.read', 'collection.read'],
  'assets:write': ['asset.create', 'asset.update', 'folder.create', 'collection.create'],
  'assets:delete': ['asset.delete', 'asset.restore', 'asset.purge'],
  'uploads:create': ['asset.create'],
  'folders:read': ['folder.read'],
  'folders:write': ['folder.create', 'folder.update', 'folder.delete'],
  'collections:read': ['collection.read'],
  'collections:write': ['collection.create', 'collection.update', 'collection.delete'],
  'references:read': ['asset.read'],
  'references:write': ['asset.update'],
  'webhooks:read': ['webhook.read'],
  'webhooks:write': ['webhook.manage'],
};

/**
 * Central Authorization Function (Master Prompt Section 10)
 * authorize(principal, action, resource)
 */
export function authorize(
  principal: AuthPrincipal,
  action: PermissionAction,
  resource?: { workspaceId?: string; ownerId?: string }
): boolean {
  if (!principal) {
    throw AppError.unauthorized('No authenticated principal provided');
  }

  // Tenant Boundary Check: Principal can only access resources in their own workspace
  if (resource?.workspaceId && resource.workspaceId !== principal.workspaceId) {
    throw AppError.forbidden(
      `Tenant Isolation Violation: Principal belonging to workspace [${principal.workspaceId}] cannot access resource in [${resource.workspaceId}]`,
      ErrorCodes.PERMISSION_DENIED
    );
  }

  // User session with admin / full access
  if (principal.scopes.includes('*')) {
    return true;
  }

  // API Key scope inspection
  const allowed = principal.scopes.some((scope) => {
    if (scope === '*') return true;
    const mappedPerms = SCOPE_TO_PERMISSION_MAP[scope] || [];
    return mappedPerms.includes(action) || scope === action;
  });

  if (!allowed) {
    throw AppError.forbidden(
      `Permission Denied: Principal lacks required permission [${action}]. Granted scopes: [${principal.scopes.join(', ')}]`,
      ErrorCodes.PERMISSION_DENIED
    );
  }

  return true;
}
