import crypto from 'crypto';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { AppError } from '@/lib/errors/app-error';
import { ErrorCodes } from '@/lib/errors/codes';
import { IdempotencyRecord } from '@/types/database';

export type IdempotencyStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export interface ExtendedIdempotencyRecord extends IdempotencyRecord {
  status?: IdempotencyStatus;
  method?: string;
}

// In-memory store for development/testing
const memoryIdempotency = new Map<string, ExtendedIdempotencyRecord>();

export const idempotencyService = {
  /**
   * Compute deterministic SHA-256 fingerprint binding method, route, and canonical payload
   */
  computeFingerprint(method: string, route: string, payload: any): string {
    const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
    return crypto
      .createHash('sha256')
      .update(`${method.toUpperCase()}:${route}:${serialized}`)
      .digest('hex');
  },

  /**
   * Reserve an idempotency key atomically before beginning business logic execution.
   * Prevents concurrent race conditions by inserting a PENDING record.
   */
  async reserveOrGetCached(
    workspaceId: string,
    idempotencyKey: string,
    route: string,
    method: string,
    payload: any,
    ttlHours: number = 24
  ): Promise<{ action: 'execute' | 'cached'; cachedRecord?: ExtendedIdempotencyRecord }> {
    const hash = this.computeFingerprint(method, route, payload);
    const recordKey = `${workspaceId}:${idempotencyKey}`;
    const now = Date.now();
    const expiresAt = new Date(now + ttlHours * 3600 * 1000).toISOString();

    // Fast In-Memory Check for test / non-Supabase environments
    if (!isSupabaseAdminConfigured()) {
      const existing = memoryIdempotency.get(recordKey);
      if (existing) {
        if (new Date(existing.expires_at).getTime() <= now) {
          // Expired, allow takeover
          memoryIdempotency.delete(recordKey);
        } else {
          // Check route & method
          if (existing.route !== route || (existing.method && existing.method !== method.toUpperCase())) {
            throw AppError.conflict(
              `Idempotency-Key "${idempotencyKey}" was reused for a different endpoint or HTTP method.`,
              ErrorCodes.IDEMPOTENCY_CONFLICT
            );
          }

          // Check fingerprint
          if (existing.request_hash !== hash) {
            throw AppError.conflict(
              `Idempotency-Key "${idempotencyKey}" was previously executed with a different request payload.`,
              ErrorCodes.IDEMPOTENCY_CONFLICT
            );
          }

          if (existing.status === 'PENDING') {
            throw AppError.conflict(
              `A concurrent request with Idempotency-Key "${idempotencyKey}" is currently in progress.`,
              ErrorCodes.IDEMPOTENCY_CONFLICT
            );
          }

          if (existing.status === 'COMPLETED') {
            return { action: 'cached', cachedRecord: existing };
          }
        }
      }

      // Create new pending reservation
      const newRec: ExtendedIdempotencyRecord = {
        id: `idemp_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
        workspace_id: workspaceId,
        idempotency_key: idempotencyKey,
        route,
        method: method.toUpperCase(),
        request_hash: hash,
        status: 'PENDING',
        response_status: 0,
        response_headers: {},
        response_body: null,
        expires_at: expiresAt,
        created_at: new Date().toISOString(),
      };
      memoryIdempotency.set(recordKey, newRec);
      return { action: 'execute' };
    }

    // Atomic PostgreSQL RPC execution with row-level lock
    try {
      const reservationId = `idemp_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
      const { data, error } = await supabaseAdmin.rpc('reserve_idempotency_key', {
        p_id: reservationId,
        p_workspace_id: workspaceId,
        p_idempotency_key: idempotencyKey,
        p_route: route,
        p_method: method.toUpperCase(),
        p_request_hash: hash,
        p_ttl_hours: ttlHours,
      });

      if (error || !data) {
        throw error || new Error('No data returned from reserve_idempotency_key');
      }

      if (data.action === 'execute') {
        return { action: 'execute' };
      }

      if (data.action === 'cached') {
        return {
          action: 'cached',
          cachedRecord: {
            id: reservationId,
            workspace_id: workspaceId,
            idempotency_key: idempotencyKey,
            route,
            method: method.toUpperCase(),
            request_hash: hash,
            status: 'COMPLETED',
            response_status: data.response_status,
            response_headers: data.response_headers || {},
            response_body: data.response_body,
            expires_at: expiresAt,
            created_at: new Date().toISOString(),
          },
        };
      }

      if (data.action === 'in_progress') {
        throw AppError.conflict(
          data.error || `A concurrent request with Idempotency-Key "${idempotencyKey}" is currently in progress.`,
          ErrorCodes.IDEMPOTENCY_CONFLICT
        );
      }

      if (data.action === 'conflict') {
        throw AppError.conflict(
          data.error || `Idempotency-Key conflict detected for key "${idempotencyKey}".`,
          ErrorCodes.IDEMPOTENCY_CONFLICT
        );
      }

      return { action: 'execute' };
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      console.warn('[Idempotency] RPC error, failing open to proceed:', err.message);
      return { action: 'execute' };
    }
  },

  /**
   * Save successful or final response for an idempotency key
   */
  async saveResponse(
    workspaceId: string,
    idempotencyKey: string,
    route: string,
    payload: any,
    responseStatus: number,
    responseHeaders: Record<string, string>,
    responseBody: any,
    ttlHours: number = 24
  ): Promise<void> {
    const hash = this.computeFingerprint('POST', route, payload);
    const recordKey = `${workspaceId}:${idempotencyKey}`;
    const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();

    const mem = memoryIdempotency.get(recordKey);
    if (mem) {
      mem.status = 'COMPLETED';
      mem.response_status = responseStatus;
      mem.response_headers = responseHeaders;
      mem.response_body = responseBody;
    } else {
      memoryIdempotency.set(recordKey, {
        id: `idemp_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
        workspace_id: workspaceId,
        idempotency_key: idempotencyKey,
        route,
        method: 'POST',
        request_hash: hash,
        status: 'COMPLETED',
        response_status: responseStatus,
        response_headers: responseHeaders,
        response_body: responseBody,
        expires_at: expiresAt,
        created_at: new Date().toISOString(),
      });
    }

    if (isSupabaseAdminConfigured()) {
      try {
        await supabaseAdmin.rpc('complete_idempotency_key', {
          p_workspace_id: workspaceId,
          p_idempotency_key: idempotencyKey,
          p_response_status: responseStatus,
          p_response_headers: responseHeaders,
          p_response_body: responseBody,
        });
      } catch (err: any) {
        console.warn('[Idempotency] Failed to complete idempotency record in DB:', err.message);
      }
    }
  },

  /**
   * Mark idempotency reservation as failed to permit clean client retries
   */
  async markFailed(workspaceId: string, idempotencyKey: string): Promise<void> {
    const recordKey = `${workspaceId}:${idempotencyKey}`;
    memoryIdempotency.delete(recordKey);

    if (isSupabaseAdminConfigured()) {
      try {
        await supabaseAdmin.rpc('fail_idempotency_key', {
          p_workspace_id: workspaceId,
          p_idempotency_key: idempotencyKey,
        });
      } catch (err: any) {
        console.warn('[Idempotency] Failed to mark reservation failed:', err.message);
      }
    }
  },

  /**
   * Backwards-compatible validator
   */
  async validateAndGetCached(
    workspaceId: string,
    idempotencyKey: string,
    route: string,
    payload: any
  ): Promise<ExtendedIdempotencyRecord | null> {
    const res = await this.reserveOrGetCached(workspaceId, idempotencyKey, route, 'POST', payload);
    if (res.action === 'cached' && res.cachedRecord) {
      return res.cachedRecord;
    }
    return null;
  },
};
