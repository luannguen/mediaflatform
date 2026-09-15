import { NextRequest } from 'next/server';
import { developerService } from '@/services/developerService';
import { SESSION_COOKIE_NAME, verifySessionToken, UserRole } from '@/lib/auth/session';
import { mockWorkspace } from '@/lib/mock/store';
import { AppError } from '@/lib/errors/app-error';
import { ErrorCodes } from '@/lib/errors/codes';
import { resolveAuthorizedWorkspace } from '@/lib/security/workspace-resolver';
import crypto from 'node:crypto';
import { hasScope } from './api-key';
import { requestState } from '@/lib/platform/requestState';

export interface AuthPrincipal {
  type: 'api_key' | 'user' | 'worker_service' | 'anonymous_dev';
  workspaceId: string;
  scopes: string[];
  apiKeyId?: string;
  serviceAccountId?: string;
  userId?: string;
  role?: UserRole;
  workerId?: string;
  organizationId?: string;
  sessionNeedsRefresh?: boolean;
}

export const WORKER_ALLOWED_SCOPES = [
  'jobs:claim',
  'jobs:heartbeat',
  'jobs:progress',
  'jobs:complete',
  'jobs:fail',
  'jobs:process',
  'jobs:read',
];

const ROLE_DEFAULT_SCOPES: Record<UserRole, string[]> = {
  owner: ['*'],
  admin: ['*'],
  media_manager: ['assets:*', 'folders:*', 'collections:*', 'uploads:*', 'references:*', 'jobs:*', 'usage:read', 'analytics:read', 'audit:read'],
  editor: ['assets:read', 'assets:write', 'assets:delete', 'uploads:create', 'folders:*', 'collections:*', 'references:read', 'references:write', 'jobs:read', 'jobs:retry', 'analytics:read'],
  uploader: ['assets:read', 'uploads:create', 'folders:read', 'collections:read'],
  viewer: ['assets:read', 'folders:read', 'collections:read', 'references:read'],
  developer: ['assets:*', 'uploads:create', 'folders:*', 'collections:*', 'references:*', 'jobs:*', 'webhooks:*', 'analytics:read', 'usage:read'],
};

/**
 * Extract and authenticate principal from request headers or session cookies
 */
async function authenticateUncached(
  req: NextRequest,
  requiredScope?: string
): Promise<AuthPrincipal> {
  const authHeader = req.headers.get('Authorization');

  // 1. Check Worker Service Token Authentication (Background Daemon & Queue Workers)
  const workerServiceToken = process.env.WORKER_SERVICE_TOKEN;
  if (authHeader && authHeader.startsWith('Bearer sec_worker_')) {
    const candidateToken = authHeader.replace('Bearer ', '').trim();
    if (workerServiceToken && candidateToken.length === workerServiceToken.length && crypto.timingSafeEqual(Buffer.from(candidateToken), Buffer.from(workerServiceToken))) {
      if (requiredScope) {
        const isAllowedWorkerScope =
          WORKER_ALLOWED_SCOPES.includes(requiredScope);

        if (!isAllowedWorkerScope) {
          throw AppError.forbidden(
            `Worker service token lacks required scope [${requiredScope}] and is forbidden from user/delivery operations`,
            ErrorCodes.PERMISSION_DENIED
          );
        }
      }

      return {
        type: 'worker_service',
        workspaceId: req.headers.get('X-Workspace-Id') || mockWorkspace.id,
        scopes: [...WORKER_ALLOWED_SCOPES],
        workerId: req.headers.get('X-Worker-Id') || 'daemon_service',
      };
    }
  }

  // 2. Check API Key Authentication (Integration API)
  const apiKeyHeader = req.headers.get('X-Media-Api-Key');

  let rawKey: string | null = null;
  if (apiKeyHeader) {
    rawKey = apiKeyHeader;
  } else if (authHeader && authHeader.startsWith('Bearer mda_')) {
    rawKey = authHeader.replace('Bearer ', '').trim();
  }

  if (rawKey) {
    const authResult = await developerService.authenticateApiKey(rawKey, requiredScope);
    return {
      type: 'api_key',
      workspaceId: authResult.workspaceId,
      scopes: authResult.scopes,
      apiKeyId: authResult.apiKeyId,
      serviceAccountId: authResult.serviceAccountId,
    };
  }

  // 3. Check Session Cookie Authentication (Web Dashboard)
  const sessionCookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionToken(sessionCookie);

  if (session) {
    // Authorize workspace & resolve current authoritative role directly from PostgreSQL
    const resolved = await resolveAuthorizedWorkspace({
      userId: session.userId,
      userEmail: session.email,
      requestedWorkspaceId: session.workspaceId,
    });

    const realRole = resolved.role;
    const realWorkspaceId = resolved.workspace.id;
    const scopes = ROLE_DEFAULT_SCOPES[realRole] || ['assets:read'];

    // Enforce required scope if specified
    if (requiredScope) {
      const isAllowed = scopes.some((s) => {
        if (s === '*' || s === requiredScope) return true;
        if (s.endsWith(':*')) {
          const domain = s.split(':')[0];
          return requiredScope.startsWith(`${domain}:`);
        }
        return false;
      });

      if (!isAllowed) {
        throw AppError.forbidden(
          `Permission denied: Role [${realRole}] lacks required scope [${requiredScope}]`,
          ErrorCodes.PERMISSION_DENIED
        );
      }
    }

    return {
      type: 'user',
      userId: session.userId,
      role: realRole,
      workspaceId: realWorkspaceId,
      organizationId: resolved.workspace.organization_id,
      scopes,
      sessionNeedsRefresh:
        Boolean(resolved.sessionNeedsRefresh) ||
        realWorkspaceId !== session.workspaceId ||
        realRole !== session.role,
    };
  }

  // 3. Fallback for Local Development / Testing Scripts if explicitly passed
  const devKey = req.headers.get('X-Dev-Bypass');
  if (process.env.NODE_ENV === 'test' && process.env.ALLOW_TEST_AUTH_BYPASS === 'true' && devKey === 'media_dev_testing') {
    return {
      type: 'anonymous_dev',
      workspaceId: req.headers.get('X-Workspace-Id') || mockWorkspace.id,
      scopes: ['*'],
    };
  }

  // In production or unauthenticated requests, reject with 401 AUTH_REQUIRED
  throw AppError.unauthorized(
    'Authentication required. Please provide a valid X-Media-Api-Key header or log in to the dashboard.',
    ErrorCodes.AUTH_REQUIRED
  );
}

export async function authenticateRequest(req: NextRequest, requiredScope?: string): Promise<AuthPrincipal> {
  const state = requestState.getStore();
  const principal = state?.principal || await authenticateUncached(req, requiredScope);
  if (requiredScope && (!hasScope(principal.scopes, requiredScope) || principal.type === 'worker_service' && !WORKER_ALLOWED_SCOPES.includes(requiredScope))) throw AppError.forbidden('Required scope is missing');
  if (requiredScope && ['jobs:claim','jobs:heartbeat','jobs:progress','jobs:complete','jobs:fail','jobs:process'].includes(requiredScope) && principal.type !== 'worker_service') throw AppError.forbidden('Worker credentials are required');
  if (state) state.principal = principal;
  return principal;
}
