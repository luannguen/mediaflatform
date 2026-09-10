import crypto from 'crypto';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { AppError } from '@/lib/errors/app-error';
import { ErrorCodes } from '@/lib/errors/codes';
import { IdempotencyRecord } from '@/types/database';

// In-memory store for development/testing
const memoryIdempotency = new Map<string, IdempotencyRecord>();

export const idempotencyService = {
  computeFingerprint(payload: any): string {
    const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
    return crypto.createHash('sha256').update(serialized).digest('hex');
  },

  async getRecord(workspaceId: string, idempotencyKey: string): Promise<IdempotencyRecord | null> {
    const recordKey = `${workspaceId}:${idempotencyKey}`;

    if (!isSupabaseAdminConfigured() || process.env.NODE_ENV === 'test') {
      const record = memoryIdempotency.get(recordKey);
      if (record && new Date(record.expires_at) > new Date()) {
        return record;
      }
      return null;
    }

    const { data, error } = await supabaseAdmin
      .from('idempotency_records')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (error || !data) return null;
    if (new Date(data.expires_at) <= new Date()) return null;

    return data as IdempotencyRecord;
  },

  async validateAndGetCached(
    workspaceId: string,
    idempotencyKey: string,
    route: string,
    payload: any
  ): Promise<IdempotencyRecord | null> {
    const record = await this.getRecord(workspaceId, idempotencyKey);
    if (!record) return null;

    const currentHash = this.computeFingerprint(payload);
    if (record.request_hash !== currentHash) {
      throw AppError.conflict(
        `Idempotency-Key "${idempotencyKey}" was previously executed with a different request payload.`,
        ErrorCodes.IDEMPOTENCY_CONFLICT
      );
    }

    return record;
  },

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
    const id = `idemp_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    const hash = this.computeFingerprint(payload);
    const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();

    const record: IdempotencyRecord = {
      id,
      workspace_id: workspaceId,
      idempotency_key: idempotencyKey,
      route,
      request_hash: hash,
      response_status: responseStatus,
      response_headers: responseHeaders,
      response_body: responseBody,
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    };

    const recordKey = `${workspaceId}:${idempotencyKey}`;
    memoryIdempotency.set(recordKey, record);

    if (isSupabaseAdminConfigured()) {
      try {
        await supabaseAdmin.from('idempotency_records').upsert(record, {
          onConflict: 'workspace_id,idempotency_key',
        });
      } catch (err: any) {
        console.warn('[Idempotency] Failed to persist idempotency record:', err.message);
      }
    }
  },
};
