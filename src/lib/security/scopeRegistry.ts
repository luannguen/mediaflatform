/**
 * Centralized Scope Registry
 * Single Source of Truth for all API Permissions across API Keys, Roles, and Worker Tokens.
 */

export interface ScopeDefinition {
  scope: string;
  category: 'assets' | 'uploads' | 'references' | 'folders' | 'collections' | 'jobs' | 'webhooks' | 'analytics' | 'system';
  description: string;
  isInternalOnly?: boolean;
}

export const SCOPE_CATALOG: ScopeDefinition[] = [
  // Assets
  { scope: 'assets:read', category: 'assets', description: 'Read assets, metadata, versions, and variants' },
  { scope: 'assets:write', category: 'assets', description: 'Create and update asset metadata, titles, and focal points' },
  { scope: 'assets:delete', category: 'assets', description: 'Soft delete assets (move to trash)' },
  { scope: 'assets:purge', category: 'assets', description: 'Permanently purge assets and complete artifact graphs' },
  { scope: 'assets:visibility:write', category: 'assets', description: 'Change asset visibility between public and private' },

  // Uploads
  { scope: 'uploads:create', category: 'uploads', description: 'Initialize presigned and direct upload sessions' },

  // References
  { scope: 'references:read', category: 'references', description: 'List external entity references for assets' },
  { scope: 'references:write', category: 'references', description: 'Create and atomically sync entity references (Safe Delete)' },

  // Folders & Collections
  { scope: 'folders:read', category: 'folders', description: 'List and browse folder structures' },
  { scope: 'folders:write', category: 'folders', description: 'Create, rename, and manage folders' },
  { scope: 'collections:read', category: 'collections', description: 'List and view curated asset collections' },
  { scope: 'collections:write', category: 'collections', description: 'Create, update, and manage asset collections' },

  // Processing Jobs
  { scope: 'jobs:read', category: 'jobs', description: 'Inspect background processing job status and progress' },
  { scope: 'jobs:retry', category: 'jobs', description: 'Manually retry failed or dead-letter jobs' },

  // Internal Worker Scopes (Strictly restricted to WORKER_SERVICE_TOKEN)
  { scope: 'jobs:claim', category: 'jobs', description: 'Claim next available queue job with lease fence', isInternalOnly: true },
  { scope: 'jobs:heartbeat', category: 'jobs', description: 'Renew active job lease heartbeat', isInternalOnly: true },
  { scope: 'jobs:progress', category: 'jobs', description: 'Report incremental job stage progress', isInternalOnly: true },
  { scope: 'jobs:complete', category: 'jobs', description: 'CAS atomic publish of processed media artifacts', isInternalOnly: true },
  { scope: 'jobs:fail', category: 'jobs', description: 'Report job failure with exponential backoff or DLQ', isInternalOnly: true },
  { scope: 'jobs:process', category: 'jobs', description: 'HTTP worker trigger execution endpoint', isInternalOnly: true },

  // Webhooks
  { scope: 'webhooks:read', category: 'webhooks', description: 'List webhook endpoints and inspect delivery histories' },
  { scope: 'webhooks:write', category: 'webhooks', description: 'Register endpoints, rotate secrets, and trigger replays' },

  // Observability & Operations
  { scope: 'analytics:read', category: 'analytics', description: 'Read media delivery telemetry and bandwidth savings' },
  { scope: 'usage:read', category: 'analytics', description: 'Read workspace storage, asset counts, and quota status' },
  { scope: 'audit:read', category: 'system', description: 'Query immutable security audit logs and resource timelines' },
  { scope: 'system:read', category: 'system', description: 'Access deep operational health, worker fleet, and diagnostics' },
  { scope: 'admin:manage', category: 'system', description: 'Administer worker fleet, key rotations, and service accounts' },
  { scope: 'system:manage', category: 'system', description: 'Super-user operational management' },
];

export const VALID_SCOPES = new Set(SCOPE_CATALOG.map((s) => s.scope));
VALID_SCOPES.add('*'); // Super-admin wildcard

export const PUBLIC_ISSUABLE_SCOPES = new Set(
  SCOPE_CATALOG.filter((s) => !s.isInternalOnly).map((s) => s.scope)
);
PUBLIC_ISSUABLE_SCOPES.add('*');

export function isValidScope(scope: string): boolean {
  if (VALID_SCOPES.has(scope)) return true;
  // Wildcard patterns like assets:* or folders:*
  if (scope.endsWith(':*')) {
    const domain = scope.split(':')[0];
    return SCOPE_CATALOG.some((s) => s.scope.startsWith(`${domain}:`));
  }
  return false;
}

export function validateRequestedScopes(scopes: string[]): { valid: boolean; invalidScopes: string[] } {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return { valid: false, invalidScopes: ['(empty scopes array)'] };
  }

  const invalidScopes: string[] = [];
  for (const s of scopes) {
    if (!isValidScope(s)) {
      invalidScopes.push(s);
    }
  }

  return {
    valid: invalidScopes.length === 0,
    invalidScopes,
  };
}

export const scopeRegistry = {
  isValidScope,
  validateScopes: validateRequestedScopes,
  validateRequestedScopes,
  SCOPE_CATALOG,
  VALID_SCOPES,
  PUBLIC_ISSUABLE_SCOPES,
};

