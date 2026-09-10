import { Application, ServiceAccount, ApiKey, ApiRequestLog } from '@/types/database';
import { AppError } from '@/lib/errors/app-error';
import { ErrorCodes } from '@/lib/errors/codes';
import { generateId } from '@/lib/ids/generator';
import { generateApiKey, verifyApiKeyHash, hasScope } from '@/lib/security/api-key';
import { validateRequestedScopes } from '@/lib/security/scopeRegistry';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { mockDb, mockWorkspace } from '@/lib/mock/store';

export const developerService = {
  async listApplications(workspaceId: string = mockWorkspace.id): Promise<Application[]> {
    if (isSupabaseAdminConfigured()) {
      try {
        const { data, error } = await supabaseAdmin.from('applications').select('*').eq('workspace_id', workspaceId);
        if (!error && data) return data as Application[];
      } catch {
        // Fallback to in-memory mock store
      }
    }
    return mockDb.applications.filter((a) => a.workspace_id === workspaceId);
  },

  async createApplication(
    workspaceId: string = mockWorkspace.id,
    input: { name: string; slug?: string; description?: string; environment?: 'development' | 'staging' | 'production' }
  ): Promise<Application> {
    const id = generateId('app');
    const slug = input.slug || input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const now = new Date().toISOString();

    const app: Application = {
      id,
      workspace_id: workspaceId,
      name: input.name,
      slug,
      description: input.description || null,
      environment: input.environment || 'production',
      status: 'active',
      allowed_origins: [],
      allowed_callback_urls: [],
      default_scopes: ['assets:read', 'assets:write', 'uploads:create', 'references:write'],
      created_at: now,
      updated_at: now,
    };

    if (isSupabaseAdminConfigured()) {
      try {
        const { data, error } = await supabaseAdmin.from('applications').insert(app).select().single();
        if (!error && data) return data as Application;
      } catch {
        // Fallback
      }
    }

    mockDb.applications.push(app);
    return app;
  },

  async listServiceAccounts(workspaceId: string = mockWorkspace.id, applicationId?: string): Promise<ServiceAccount[]> {
    if (isSupabaseAdminConfigured()) {
      try {
        let query = supabaseAdmin.from('service_accounts').select('*').eq('workspace_id', workspaceId);
        if (applicationId) query = query.eq('application_id', applicationId);
        const { data, error } = await query;
        if (!error && data) return data as ServiceAccount[];
      } catch {
        // Fallback
      }
    }

    let list = mockDb.serviceAccounts.filter((s) => s.workspace_id === workspaceId);
    if (applicationId) list = list.filter((s) => s.application_id === applicationId);
    return list;
  },

  async createServiceAccount(
    workspaceId: string = mockWorkspace.id,
    applicationId: string,
    name: string,
    description?: string
  ): Promise<ServiceAccount> {
    const id = generateId('svc');
    const now = new Date().toISOString();
    const svc: ServiceAccount = {
      id,
      workspace_id: workspaceId,
      application_id: applicationId,
      name,
      description: description || null,
      status: 'active',
      created_at: now,
      updated_at: now,
    };

    if (isSupabaseAdminConfigured()) {
      try {
        const { data, error } = await supabaseAdmin.from('service_accounts').insert(svc).select().single();
        if (!error && data) return data as ServiceAccount;
      } catch {
        // Fallback
      }
    }

    mockDb.serviceAccounts.push(svc);
    return svc;
  },

  /**
   * Get an existing service account or automatically provision a default one
   */
  async getOrCreateDefaultServiceAccount(workspaceId: string = mockWorkspace.id): Promise<ServiceAccount> {
    const existing = await this.listServiceAccounts(workspaceId);
    if (existing.length > 0) {
      return existing[0];
    }

    // Find or create default application
    let apps = await this.listApplications(workspaceId);
    let appId: string;
    if (apps.length > 0) {
      appId = apps[0].id;
    } else {
      const app = await this.createApplication(workspaceId, {
        name: 'Default Application',
        slug: 'default-app',
        description: 'Primary external application integration',
      });
      appId = app.id;
    }

    return this.createServiceAccount(
      workspaceId,
      appId,
      'default-service-account',
      'Default service account for external API integrations'
    );
  },

  async listApiKeys(workspaceId: string = mockWorkspace.id): Promise<Omit<ApiKey, 'key_hash'>[]> {
    if (isSupabaseAdminConfigured()) {
      try {
        const { data, error } = await supabaseAdmin
          .from('api_keys')
          .select('id, workspace_id, service_account_id, name, key_prefix, scopes, status, expires_at, last_used_at, created_at, revoked_at')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false });
        if (!error && data) return data as Omit<ApiKey, 'key_hash'>[];
      } catch {
        // Fallback
      }
    }

    return mockDb.apiKeys
      .filter((k) => k.workspace_id === workspaceId)
      .map(({ key_hash, ...rest }) => rest);
  },

  /**
   * Create an API Key:
   * Generates raw key mda_live_...
   * Database only stores key_prefix and key_hash!
   * Returns rawKey to be displayed EXACTLY ONCE to the user!
   */
  async createApiKey(
    workspaceId: string = mockWorkspace.id,
    serviceAccountId: string,
    name: string,
    scopes: string[] = ['assets:read'],
    environment: 'development' | 'staging' | 'production' = 'production'
  ): Promise<{ rawKey: string; keyRecord: Omit<ApiKey, 'key_hash'> }> {
    // 1. Verify service account exists and belongs to workspace
    if (isSupabaseAdminConfigured()) {
      const { data: svc, error: svcErr } = await supabaseAdmin
        .from('service_accounts')
        .select('id, workspace_id')
        .eq('id', serviceAccountId)
        .maybeSingle();

      if (svcErr || !svc || svc.workspace_id !== workspaceId) {
        throw AppError.badRequest(
          `Service account ${serviceAccountId} does not exist or does not belong to workspace ${workspaceId}`,
          ErrorCodes.VALIDATION_ERROR
        );
      }
    } else {
      const svc = mockDb.serviceAccounts.find((s) => s.id === serviceAccountId && s.workspace_id === workspaceId);
      if (!svc) {
        throw AppError.badRequest(
          `Service account ${serviceAccountId} does not exist or does not belong to workspace ${workspaceId}`,
          ErrorCodes.VALIDATION_ERROR
        );
      }
    }

    // 2. Validate requested scopes against Scope Registry
    const scopeCheck = validateRequestedScopes(scopes);
    if (!scopeCheck.valid) {
      throw AppError.badRequest(
        `Invalid scopes requested: ${scopeCheck.invalidScopes.join(', ')}`,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    const { rawKey, keyPrefix, keyHash } = generateApiKey(true);
    const id = generateId('key');
    const now = new Date().toISOString();

    const apiKeyRecord: ApiKey = {
      id,
      workspace_id: workspaceId,
      service_account_id: serviceAccountId,
      name,
      key_prefix: keyPrefix,
      key_hash: keyHash,
      scopes,
      status: 'active',
      environment,
      created_at: now,
    };

    if (isSupabaseAdminConfigured()) {
      try {
        const { data, error } = await supabaseAdmin.from('api_keys').insert(apiKeyRecord).select().single();
        if (!error && data) {
          const { key_hash, ...safeRecord } = data as ApiKey;
          return { rawKey, keyRecord: safeRecord };
        }
      } catch {
        // Fallback
      }
    }

    mockDb.apiKeys.push(apiKeyRecord);
    const { key_hash, ...safeRecord } = apiKeyRecord;
    return { rawKey, keyRecord: safeRecord };
  },

  /**
   * Rotate an API Key:
   * Generates a successor key with identical scopes and service account.
   * Sets grace period on the old key so existing clients have zero downtime.
   */
  async rotateApiKey(
    keyId: string,
    workspaceId: string = mockWorkspace.id,
    gracePeriodDays: number = 7
  ): Promise<{ rawKey: string; newKeyRecord: Omit<ApiKey, 'key_hash'>; oldKeyRecord: Omit<ApiKey, 'key_hash'> }> {
    let existingKey: ApiKey | undefined;

    if (isSupabaseAdminConfigured()) {
      const { data, error } = await supabaseAdmin
        .from('api_keys')
        .select('*')
        .eq('id', keyId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      if (error || !data) {
        throw AppError.notFound(`API key ${keyId} not found in workspace ${workspaceId}`);
      }
      existingKey = data as ApiKey;
    } else {
      existingKey = mockDb.apiKeys.find((k) => k.id === keyId && k.workspace_id === workspaceId);
      if (!existingKey) {
        throw AppError.notFound(`API key ${keyId} not found in workspace ${workspaceId}`);
      }
    }

    if (existingKey.status === 'revoked') {
      throw AppError.badRequest('Cannot rotate an already revoked API key', ErrorCodes.API_KEY_REVOKED);
    }

    const now = new Date();
    const graceExpiration = new Date(now.getTime() + gracePeriodDays * 24 * 3600 * 1000).toISOString();

    // 1. Create successor key
    const { rawKey: newRawKey, keyPrefix: newPrefix, keyHash: newHash } = generateApiKey(true);
    const newKeyId = generateId('key');

    const newKeyRecord: ApiKey = {
      id: newKeyId,
      workspace_id: workspaceId,
      service_account_id: existingKey.service_account_id,
      name: `${existingKey.name} (Rotated)`,
      key_prefix: newPrefix,
      key_hash: newHash,
      scopes: existingKey.scopes,
      status: 'active',
      environment: existingKey.environment || 'production',
      replaces_key_id: existingKey.id,
      created_at: now.toISOString(),
    };

    // 2. Update old key with rotated_at and grace period expiry
    existingKey.rotated_at = now.toISOString();
    existingKey.expires_at = graceExpiration;

    if (isSupabaseAdminConfigured()) {
      await supabaseAdmin.from('api_keys').insert(newKeyRecord);
      await supabaseAdmin
        .from('api_keys')
        .update({
          rotated_at: existingKey.rotated_at,
          expires_at: existingKey.expires_at,
        })
        .eq('id', existingKey.id);
    } else {
      mockDb.apiKeys.push(newKeyRecord);
    }

    const { key_hash: _h1, ...safeNew } = newKeyRecord;
    const { key_hash: _h2, ...safeOld } = existingKey;

    return {
      rawKey: newRawKey,
      newKeyRecord: safeNew,
      oldKeyRecord: safeOld,
    };
  },

  async revokeApiKey(keyId: string, workspaceId: string = mockWorkspace.id): Promise<boolean> {
    const now = new Date().toISOString();
    if (!isSupabaseAdminConfigured()) {
      const k = mockDb.apiKeys.find((item) => item.id === keyId && item.workspace_id === workspaceId);
      if (!k) throw AppError.notFound(`API key ${keyId} not found`);
      k.status = 'revoked';
      k.revoked_at = now;
      return true;
    }

    const { error } = await supabaseAdmin
      .from('api_keys')
      .update({ status: 'revoked', revoked_at: now })
      .eq('id', keyId)
      .eq('workspace_id', workspaceId);

    if (error) throw AppError.internal(`Failed to revoke API key: ${error.message}`);
    return true;
  },

  /**
   * Asynchronously record an API request log without blocking
   */
  recordApiRequestLog(log: Omit<ApiRequestLog, 'id' | 'created_at'>) {
    const id = generateId('log');
    const fullLog: ApiRequestLog = {
      id,
      ...log,
      created_at: new Date().toISOString(),
    };

    if (!isSupabaseAdminConfigured()) {
      if (!(mockDb as any).apiRequestLogs) (mockDb as any).apiRequestLogs = [];
      (mockDb as any).apiRequestLogs.unshift(fullLog);
      if ((mockDb as any).apiRequestLogs.length > 500) (mockDb as any).apiRequestLogs.pop();
      return;
    }

    supabaseAdmin
      .from('api_request_logs')
      .insert(fullLog)
      .then(({ error }) => {
        if (error) console.warn('[ApiRequestLog] Failed to record:', error.message);
      });
  },

  /**
   * List API request logs with filters and pagination
   */
  async listApiRequestLogs(
    workspaceId: string = mockWorkspace.id,
    options?: {
      limit?: number;
      offset?: number;
      route?: string;
      statusCode?: number;
      requestId?: string;
      applicationId?: string;
    }
  ): Promise<{ logs: ApiRequestLog[]; total: number }> {
    const limit = Math.min(100, Math.max(1, options?.limit || 50));
    const offset = Math.max(0, options?.offset || 0);

    if (!isSupabaseAdminConfigured()) {
      let list: ApiRequestLog[] = (mockDb as any).apiRequestLogs || [];
      list = list.filter((l) => l.workspace_id === workspaceId);
      if (options?.route) list = list.filter((l) => l.route.includes(options.route!));
      if (options?.statusCode) list = list.filter((l) => l.status_code === options.statusCode);
      if (options?.requestId) list = list.filter((l) => l.request_id === options.requestId);
      if (options?.applicationId) list = list.filter((l) => l.application_id === options.applicationId);
      return {
        logs: list.slice(offset, offset + limit),
        total: list.length,
      };
    }

    let query = supabaseAdmin
      .from('api_request_logs')
      .select('*', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (options?.route) query = query.ilike('route', `%${options.route}%`);
    if (options?.statusCode) query = query.eq('status_code', options.statusCode);
    if (options?.requestId) query = query.eq('request_id', options.requestId);
    if (options?.applicationId) query = query.eq('application_id', options.applicationId);

    const { data, count, error } = await query.range(offset, offset + limit - 1);
    if (error) throw AppError.internal(`Failed to list request logs: ${error.message}`);

    return {
      logs: (data as ApiRequestLog[]) || [],
      total: count || 0,
    };
  },

  /**
   * Authenticate API Request by inspecting Header `X-Media-Api-Key` or `Authorization: Bearer mda_...`
   */
  async authenticateApiKey(rawKey: string, requiredScope?: string) {
    if (!rawKey || !rawKey.startsWith('mda_')) {
      throw AppError.unauthorized('Invalid or missing API key format (must start with mda_)', ErrorCodes.INVALID_API_KEY);
    }

    // Extract prefix
    const parts = rawKey.split('_');
    if (parts.length < 4) {
      throw AppError.unauthorized('Malformed API key format', ErrorCodes.INVALID_API_KEY);
    }
    const prefix = `${parts[0]}_${parts[1]}_${parts[2]}`;

    let matchedKey: ApiKey | undefined;

    if (!isSupabaseAdminConfigured()) {
      const candidates = mockDb.apiKeys.filter((k) => k.key_prefix === prefix && k.status === 'active');
      for (const cand of candidates) {
        if (verifyApiKeyHash(rawKey, cand.key_hash)) {
          matchedKey = cand;
          break;
        }
      }
    } else {
      const { data: candidates, error } = await supabaseAdmin
        .from('api_keys')
        .select('*')
        .eq('key_prefix', prefix);

      if (error || !candidates) {
        throw AppError.unauthorized('API key validation failed', ErrorCodes.INVALID_API_KEY);
      }

      for (const cand of candidates as ApiKey[]) {
        if (cand.status === 'revoked') {
          throw new AppError('This API key has been revoked', ErrorCodes.API_KEY_REVOKED, 401);
        }
        if (cand.status === 'expired' || (cand.expires_at && new Date(cand.expires_at) < new Date())) {
          throw new AppError('This API key has expired', ErrorCodes.API_KEY_EXPIRED, 401);
        }
        if (verifyApiKeyHash(rawKey, cand.key_hash)) {
          matchedKey = cand;
          break;
        }
      }
    }

    if (!matchedKey) {
      throw AppError.unauthorized('Invalid API key secret', ErrorCodes.INVALID_API_KEY);
    }

    if (requiredScope && !hasScope(matchedKey.scopes, requiredScope)) {
      throw AppError.forbidden(
        `API key is missing required scope: ${requiredScope}. Granted scopes: [${matchedKey.scopes.join(', ')}]`,
        ErrorCodes.PERMISSION_DENIED
      );
    }

    // Async update last_used_at without blocking
    if (isSupabaseAdminConfigured()) {
      supabaseAdmin
        .from('api_keys')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', matchedKey.id)
        .then();
    }

    return {
      apiKeyId: matchedKey.id,
      workspaceId: matchedKey.workspace_id,
      serviceAccountId: matchedKey.service_account_id,
      scopes: matchedKey.scopes,
    };
  },
};
