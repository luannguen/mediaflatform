import { hasScope } from './api-key';
import { AuthPrincipal } from './auth-guard';
import { Asset, Visibility } from '@/types/database';
import { ErrorCode, ErrorCodes } from '@/lib/errors/codes';

export type AssetAction =
  | 'asset.read'
  | 'asset.update'
  | 'asset.delete'
  | 'asset.purge'
  | 'asset.change_visibility';

export interface AuthorizationResult {
  allowed: boolean;
  code?: ErrorCode;
  message?: string;
}

/**
 * Centralized Resource-Level Authorization Engine
 */
export function authorize(
  principal: AuthPrincipal,
  action: AssetAction,
  asset: Asset
): AuthorizationResult {
  // 1. Worker Service Identity Hardening:
  // Background daemon worker tokens can ONLY claim/heartbeat/progress/fail/complete jobs.
  // They are strictly forbidden from acting as a universal superuser on normal asset APIs!
  if (principal.type === 'worker_service') {
    return {
      allowed: false,
      code: ErrorCodes.PERMISSION_DENIED,
      message: 'Worker service credentials are restricted to internal job execution APIs',
    };
  }

  // 2. Strict Workspace Isolation: Tenant A cannot access Tenant B's assets
  if (principal.workspaceId !== asset.workspace_id) {
    // Exception: public assets can be read globally by any authenticated or unauthenticated user
    if (action === 'asset.read' && asset.visibility === 'public') {
      return { allowed: true };
    }
    return {
      allowed: false,
      code: ErrorCodes.PERMISSION_DENIED,
      message: 'Forbidden: Cross-workspace access denied',
    };
  }

  const scopes: Record<AssetAction, string> = { 'asset.read': 'assets:read', 'asset.update': 'assets:write', 'asset.delete': 'assets:delete', 'asset.purge': 'assets:purge', 'asset.change_visibility': 'assets:visibility:write' };
  if (!hasScope(principal.scopes, scopes[action])) return { allowed: false, code: ErrorCodes.PERMISSION_DENIED, message: 'Required asset scope is missing' };

  // 3. Action-Specific Role Governance
  if (action === 'asset.change_visibility') {
    const role = principal.role;
    // Uploader, Viewer, or Editor roles cannot unilaterally make internal assets public
    if (role === 'uploader' || role === 'viewer') {
      return {
        allowed: false,
        code: ErrorCodes.PERMISSION_DENIED,
        message: `Role [${role}] is not authorized to alter asset visibility`,
      };
    }
  }

  if (action === 'asset.purge') {
    const role = principal.role;
    if (role && role !== 'owner' && role !== 'admin' && role !== 'media_manager') {
      return {
        allowed: false,
        code: ErrorCodes.PERMISSION_DENIED,
        message: 'Only workspace owners, admins, or media managers can permanently purge assets',
      };
    }
  }

  if (action === 'asset.delete') {
    const role = principal.role;
    if (role === 'viewer') {
      return {
        allowed: false,
        code: ErrorCodes.PERMISSION_DENIED,
        message: 'Viewers lack delete permissions',
      };
    }
  }

  // 4. Trashed / Deleted Resource Protection
  if (action === 'asset.read') {
    if (asset.status === 'deleted') {
      return {
        allowed: false,
        code: ErrorCodes.ASSET_DELETED,
        message: 'Asset has been permanently deleted',
      };
    }
  }

  return { allowed: true };
}
