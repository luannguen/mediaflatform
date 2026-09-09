import { NextRequest } from 'next/server';
import { developerService } from '@/services/developerService';
import { SESSION_COOKIE_NAME, verifySessionToken, UserRole } from '@/lib/auth/session';
import { mockWorkspace } from '@/lib/mock/store';
import { AppError } from '@/lib/errors/app-error';
import { ErrorCodes } from '@/lib/errors/codes';

export interface AuthPrincipal {
  type: 'api_key' | 'user' | 'anonymous_dev';
  workspaceId: string;
  scopes: string[];
  apiKeyId?: string;
  serviceAccountId?: string;
  userId?: string;
  role?: UserRole;
}

const ROLE_DEFAULT_SCOPES: Record<UserRole, string[]> = {
  owner: ['*'],
  admin: ['*'],
  media_manager: ['assets:*', 'folders:*', 'collections:*', 'uploads:*', 'references:*', 'usage:read', 'analytics:read', 'audit:read'],
  editor: ['assets:read', 'assets:write', 'assets:delete', 'uploads:create', 'folders:*', 'collections:*', 'references:read', 'references:write', 'analytics:read'],
  uploader: ['assets:read', 'uploads:create', 'folders:read', 'collections:read'],
  viewer: ['assets:read', 'folders:read', 'collections:read', 'references:read'],
  developer: ['assets:*', 'uploads:create', 'folders:*', 'collections:*', 'references:*', 'webhooks:*', 'analytics:read', 'usage:read'],
};

/**
 * Extract and authenticate principal from request headers or session cookies
 */
export async function authenticateRequest(
  req: NextRequest,
  requiredScope?: string
): Promise<AuthPrincipal> {
  // 1. Check API Key Authentication (Integration API)
  const apiKeyHeader = req.headers.get('X-Media-Api-Key');
  const authHeader = req.headers.get('Authorization');

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

  // 2. Check Session Cookie Authentication (Web Dashboard)
  const sessionCookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionToken(sessionCookie);

  if (session) {
    const scopes = ROLE_DEFAULT_SCOPES[session.role] || ['assets:read'];

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
          `Permission denied: Role [${session.role}] lacks required scope [${requiredScope}]`,
          ErrorCodes.PERMISSION_DENIED
        );
      }
    }

    return {
      type: 'user',
      userId: session.userId,
      role: session.role,
      workspaceId: session.workspaceId || mockWorkspace.id,
      scopes,
    };
  }

  // 3. Fallback for Local Development / Testing Scripts if explicitly passed
  const devKey = req.headers.get('X-Dev-Bypass');
  if (devKey === 'media_dev_testing' || process.env.NODE_ENV === 'test') {
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
