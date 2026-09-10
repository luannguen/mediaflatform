import crypto from 'crypto';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { AppError } from '@/lib/errors/app-error';
import { ErrorCodes } from '@/lib/errors/codes';
import { IdempotencyRecord } from '@/types/database';

export type IdempotencyStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export interface ExtendedIdempotencyRecord extends IdempotencyRecord {
  status?: IdempotencyStatus;
  method?: string;
  execution_token?: string | null;
  lease_expires_at?: string | null;
  updated_at?: string;
}

export interface IdempotencyReservationResult {
  action: 'execute' | 'cached';
  executionToken?: string;
  leaseExpiresAt?: string;
  cachedRecord?: ExtendedIdempotencyRecord;
}

export interface FencedOperationResult {
  success: boolean;
  reason?: 'RESERVATION_LOST' | 'LEASE_LOST' | string;
}

const DEFAULT_LEASE_SECONDS = parseInt(process.env.IDEMPOTENCY_LEASE_SECONDS || '60', 10);
const DEFAULT_TTL_HOURS = 24;

const SENSITIVE_HEADERS = new Set([
  'set-cookie',
  'authorization',
  'x-media-api-key',
  'x-request-id',
  'cookie',
]);

/**
 * Deterministically sort JSON keys recursively so differing insertion order produces identical hash
 */
export function canonicalizeJson(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalizeJson).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalizeJson(obj[k])).join(',') + '}';
}

/**
 * Strip volatile and security-sensitive headers before caching in idempotency store
 */
export function filterSafeHeaders(headers: Record<string, string>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (!SENSITIVE_HEADERS.has(k.toLowerCase())) {
      safe[k] = v;
    }
  }
  return safe;
}

// In-memory store for development/testing/offline environments
const memoryIdempotency = new Map<string, ExtendedIdempotencyRecord>();

export const idempotencyService = {
  /**
   * Compute deterministic SHA-256 fingerprint binding method, route, and canonical payload
   */
  computeFingerprint(method: string, route: string, payload: any): string {
    let serialized: string;
    if (typeof payload === 'string') {
      try {
        const parsed = JSON.parse(payload);
        serialized = canonicalizeJson(parsed);
      } catch {
        serialized = payload;
      }
    } else if (Buffer.isBuffer(payload)) {
      serialized = `buffer:${payload.length}:${crypto.createHash('sha256').update(payload).digest('hex')}`;
    } else {
      serialized = canonicalizeJson(payload || {});
    }

    return crypto
      .createHash('sha256')
      .update(`${method.toUpperCase()}:${route}:${serialized}`)
      .digest('hex');
  },

  /**
   * Reserve an idempotency key atomically before beginning business logic execution.
   * FAILS CLOSED: If the database or reservation subsystem is unavailable, rejects with HTTP 503 IDEMPOTENCY_UNAVAILABLE.
   * Never silently degrades to non-idempotent execution in production.
   */
  async reserveOrGetCached(
    workspaceId: string,
    idempotencyKey: string,
    route: string,
    method: string,
    payload: any,
    ttlHours: number = DEFAULT_TTL_HOURS,
    leaseSeconds: number = DEFAULT_LEASE_SECONDS
  ): Promise<IdempotencyReservationResult> {
    const hash = this.computeFingerprint(method, route, payload);
    const recordKey = `${workspaceId}:${idempotencyKey}`;
    const now = Date.now();
    const expiresAt = new Date(now + ttlHours * 3600 * 1000).toISOString();
    const leaseExpiresAt = new Date(now + leaseSeconds * 1000).toISOString();

    // Fast In-Memory Check for local test / non-Supabase environments
    if (!isSupabaseAdminConfigured()) {
      const existing = memoryIdempotency.get(recordKey);
      if (existing) {
        if (new Date(existing.expires_at).getTime() <= now) {
          // Expired TTL, allow takeover
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
            // Check lease
            const existingLease = existing.lease_expires_at ? new Date(existing.lease_expires_at).getTime() : 0;
            if (existingLease > now) {
              throw AppError.conflict(
                `A concurrent request with Idempotency-Key "${idempotencyKey}" is currently in progress.`,
                ErrorCodes.IDEMPOTENCY_CONFLICT
              );
            }
            // Stale takeover allowed
          }

          if (existing.status === 'COMPLETED') {
            return { action: 'cached', cachedRecord: existing };
          }
        }
      }

      // Create new pending reservation with execution token
      const executionToken = `idemrun_mem_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
      const newRec: ExtendedIdempotencyRecord = {
        id: `idemp_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
        workspace_id: workspaceId,
        idempotency_key: idempotencyKey,
        route,
        method: method.toUpperCase(),
        request_hash: hash,
        status: 'PENDING',
        execution_token: executionToken,
        lease_expires_at: leaseExpiresAt,
        response_status: 0,
        response_headers: {},
        response_body: null,
        expires_at: expiresAt,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      memoryIdempotency.set(recordKey, newRec);
      return { action: 'execute', executionToken, leaseExpiresAt };
    }

    // Atomic PostgreSQL RPC execution with row-level lock and lease fencing
    try {
      const reservationId = `idemp_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
      const { data, error } = await supabaseAdmin.rpc('reserve_idempotency_key', {
        p_id: reservationId,
        p_workspace_id: workspaceId,
        p_idempotency_key: idempotencyKey,
        p_route: route,
        p_method: method.toUpperCase(),
        p_request_hash: hash,
        p_lease_seconds: leaseSeconds,
        p_ttl_hours: ttlHours,
      });

      if (error || !data) {
        throw error || new Error('No data returned from reserve_idempotency_key');
      }

      if (data.action === 'execute') {
        return {
          action: 'execute',
          executionToken: data.execution_token,
          leaseExpiresAt: data.lease_expires_at,
        };
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
            execution_token: null,
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

      // Explicit fallback to 503 if unknown action
      throw AppError.serviceUnavailable(
        'Idempotency reservation returned unrecognized state.',
        ErrorCodes.IDEMPOTENCY_UNAVAILABLE
      );
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      console.error('[Idempotency] Subsystem RPC failure, strictly FAILING CLOSED:', err.message);
      // P0: MUST FAIL CLOSED. Do not execute business operation without idempotency guarantee.
      throw AppError.serviceUnavailable(
        'Idempotency subsystem is temporarily unavailable.',
        ErrorCodes.IDEMPOTENCY_UNAVAILABLE
      );
    }
  },

  /**
   * Save successful or final response for an idempotency key with execution token fencing.
   * Prevents zombie or stale workers from overwriting a newer owner's completed response.
   */
  async saveResponse(
    workspaceId: string,
    idempotencyKey: string,
    route: string,
    payload: any,
    responseStatus: number,
    responseHeaders: Record<string, string>,
    responseBody: any,
    ttlHours: number = DEFAULT_TTL_HOURS,
    executionToken?: string
  ): Promise<FencedOperationResult> {
    const hash = this.computeFingerprint('POST', route, payload);
    const recordKey = `${workspaceId}:${idempotencyKey}`;
    const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
    const safeHeaders = filterSafeHeaders(responseHeaders);

    if (!isSupabaseAdminConfigured()) {
      const hash = this.computeFingerprint('POST', route, payload);
      const recordKey = `${workspaceId}:${idempotencyKey}`;
      const mem = memoryIdempotency.get(recordKey);
      if (mem) {
        if (!executionToken || mem.execution_token === executionToken) {
          mem.status = 'COMPLETED';
          mem.response_status = responseStatus;
          mem.response_headers = safeHeaders;
          mem.response_body = responseBody;
          mem.updated_at = new Date().toISOString();
          return { success: true };
        } else {
          return { success: false, reason: 'RESERVATION_LOST' };
        }
      } else {
        memoryIdempotency.set(recordKey, {
          id: `idemp_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
          workspace_id: workspaceId,
          idempotency_key: idempotencyKey,
          route,
          method: 'POST',
          request_hash: hash,
          status: 'COMPLETED',
          execution_token: executionToken || null,
          response_status: responseStatus,
          response_headers: safeHeaders,
          response_body: responseBody,
          expires_at: expiresAt,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        return { success: true };
      }
    }

    try {
      const { data, error } = await supabaseAdmin.rpc('complete_idempotency_key', {
        p_workspace_id: workspaceId,
        p_idempotency_key: idempotencyKey,
        p_execution_token: executionToken || '',
        p_response_status: responseStatus,
        p_response_headers: safeHeaders,
        p_response_body: responseBody,
      });

      if (error) {
        console.warn('[Idempotency] Failed to complete idempotency record in DB:', error.message);
        return { success: false, reason: error.message };
      }

      return {
        success: Boolean(data?.success),
        reason: data?.reason,
      };
    } catch (err: any) {
      console.warn('[Idempotency] Failed to complete idempotency record in DB:', err.message);
      return { success: false, reason: err.message };
    }
  },

  /**
   * Mark idempotency reservation as failed to permit clean client retries.
   * Fenced by execution token: a zombie worker cannot mark a newly acquired reservation as failed.
   */
  async markFailed(
    workspaceId: string,
    idempotencyKey: string,
    executionToken?: string
  ): Promise<FencedOperationResult> {
    if (!isSupabaseAdminConfigured()) {
      const recordKey = `${workspaceId}:${idempotencyKey}`;
      const mem = memoryIdempotency.get(recordKey);
      if (mem) {
        if (!executionToken || mem.execution_token === executionToken) {
          mem.status = 'FAILED';
          mem.updated_at = new Date().toISOString();
          return { success: true };
        } else {
          return { success: false, reason: 'RESERVATION_LOST' };
        }
      }
      return { success: true };
    }

    try {
      const { data, error } = await supabaseAdmin.rpc('fail_idempotency_key', {
        p_workspace_id: workspaceId,
        p_idempotency_key: idempotencyKey,
        p_execution_token: executionToken || '',
      });

      if (error) {
        console.warn('[Idempotency] Failed to mark reservation failed in DB:', error.message);
        return { success: false, reason: error.message };
      }

      return {
        success: Boolean(data?.success),
        reason: data?.reason,
      };
    } catch (err: any) {
      console.warn('[Idempotency] Failed to mark reservation failed:', err.message);
      return { success: false, reason: err.message };
    }
  },

  /**
   * Renew lease for an in-flight long-running operation.
   * Guarantees atomic fenced extension of lease_expires_at.
   */
  async renewLease(
    workspaceId: string,
    idempotencyKey: string,
    executionToken: string,
    leaseSeconds: number = DEFAULT_LEASE_SECONDS
  ): Promise<FencedOperationResult> {
    if (!isSupabaseAdminConfigured()) {
      const recordKey = `${workspaceId}:${idempotencyKey}`;
      const now = Date.now();
      const mem = memoryIdempotency.get(recordKey);
      if (mem) {
        if (mem.execution_token === executionToken && mem.status === 'PENDING') {
          mem.lease_expires_at = new Date(now + leaseSeconds * 1000).toISOString();
          mem.updated_at = new Date(now).toISOString();
          return { success: true };
        } else {
          return { success: false, reason: 'LEASE_LOST' };
        }
      }
      return { success: false, reason: 'NOT_FOUND' };
    }

    try {
      const { data, error } = await supabaseAdmin.rpc('renew_idempotency_lease', {
        p_workspace_id: workspaceId,
        p_idempotency_key: idempotencyKey,
        p_execution_token: executionToken,
        p_lease_seconds: leaseSeconds,
      });

      if (error) {
        return { success: false, reason: error.message };
      }

      return {
        success: Boolean(data?.success),
        reason: data?.reason,
      };
    } catch (err: any) {
      return { success: false, reason: err.message };
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
