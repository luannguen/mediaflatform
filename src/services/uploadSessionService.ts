import { generateId } from '@/lib/ids/generator';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { mockDb } from '@/lib/mock/store';
import { isPersistentMode, assertPersistentBackend } from '@/lib/platform/persistence-mode';
import { getStorageProvider } from '@/lib/storage/factory';
import { DirectUploadCapability, ObjectMetadata } from '@/lib/storage/provider';
import { AppError } from '@/lib/errors/app-error';
import { ErrorCodes } from '@/lib/errors/codes';
import { Asset, ProcessingJob } from '@/types/database';

export interface UploadSession {
  id: string;
  workspace_id: string;
  folder_id?: string | null;
  storage_provider: string;
  storage_bucket: string;
  storage_key: string;
  filename: string;
  display_name?: string | null;
  mime_type: string;
  size_bytes: number;
  visibility: 'public' | 'workspace' | 'private';
  status:
    | 'created'
    | 'uploading'
    | 'uploaded'
    | 'verifying'
    | 'completed'
    | 'expired_pending_cleanup'
    | 'expired'
    | 'failed'
    | 'cancelled';
  expires_at: string;
  completed_at?: string | null;
  asset_id?: string | null;
  requested_by_type?: string;
  requested_by_id?: string;
  metadata_json?: Record<string, any>;
  created_at: string;
}

export interface CreateUploadSessionInput {
  workspaceId: string;
  filename: string;
  fileSizeBytes: number;
  mimeType: string;
  folderId?: string | null;
  displayName?: string;
  visibility?: 'public' | 'workspace' | 'private';
  metadata?: Record<string, any>;
  userId?: string | null;
  serviceAccountId?: string | null;
}

export interface FinalizeSessionResult {
  asset: Asset;
  job: ProcessingJob | null;
  idempotent: boolean;
}

export const uploadSessionService = {
  /**
   * Create a new upload session and obtain a direct-upload capability
   */
  async createSession(input: CreateUploadSessionInput): Promise<{
    session: UploadSession;
    capability: DirectUploadCapability;
  }> {
    assertPersistentBackend('UploadSessionService.createSession');

    const sessionId = generateId('sess');
    const sanitizedName = input.filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const storageKey = `uploads/${input.workspaceId}/${sessionId}/${sanitizedName}`;

    const storage = getStorageProvider();
    const capability = await storage.createDirectUploadSession({
      key: storageKey,
      mimeType: input.mimeType,
      sizeBytes: input.fileSizeBytes,
      expiresInSeconds: 3600, // 1 hour capability TTL
    });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 3600 * 1000).toISOString(); // 24 hour session TTL
    const requestedByType = input.serviceAccountId ? 'service_account' : 'user';
    const requestedById = input.serviceAccountId || input.userId || 'system';

    const sessionData: UploadSession = {
      id: sessionId,
      workspace_id: input.workspaceId,
      folder_id: input.folderId || null,
      storage_provider: 'supabase',
      storage_bucket: 'media-assets',
      storage_key: storageKey,
      filename: input.filename,
      display_name: input.displayName || input.filename.replace(/\.[^/.]+$/, ''),
      mime_type: input.mimeType,
      size_bytes: input.fileSizeBytes,
      visibility: input.visibility || 'workspace',
      status: 'created',
      expires_at: expiresAt,
      requested_by_type: requestedByType,
      requested_by_id: requestedById,
      metadata_json: {
        ...(input.metadata || {}),
        capability_protocol: capability.protocol,
      },
      created_at: now.toISOString(),
    };

    if (isSupabaseAdminConfigured()) {
      const { data, error } = await supabaseAdmin
        .from('upload_sessions')
        .insert({
          id: sessionData.id,
          workspace_id: sessionData.workspace_id,
          folder_id: sessionData.folder_id,
          storage_provider: sessionData.storage_provider,
          storage_bucket: sessionData.storage_bucket,
          storage_key: sessionData.storage_key,
          filename: sessionData.filename,
          display_name: sessionData.display_name,
          mime_type: sessionData.mime_type,
          size_bytes: sessionData.size_bytes,
          visibility: sessionData.visibility,
          status: sessionData.status,
          expires_at: sessionData.expires_at,
          requested_by_type: requestedByType,
          requested_by_id: requestedById,
          metadata_json: sessionData.metadata_json,
        })
        .select('*')
        .single();

      if (error) {
        throw AppError.internal(`Failed to create upload session: ${error.message}`, ErrorCodes.DATABASE_ERROR);
      }

      return { session: data as UploadSession, capability };
    }

    // Mock fallback (only allowed in tests / dev)
    (mockDb as any).upload_sessions = (mockDb as any).upload_sessions || [];
    (mockDb as any).upload_sessions.push(sessionData);
    return { session: sessionData, capability };
  },

  /**
   * Get an upload session by ID
   */
  async getSessionById(sessionId: string): Promise<UploadSession | null> {
    if (isSupabaseAdminConfigured()) {
      const { data, error } = await supabaseAdmin
        .from('upload_sessions')
        .select('*')
        .eq('id', sessionId)
        .maybeSingle();

      if (error || !data) return null;
      return data as UploadSession;
    }

    const sessions = (mockDb as any).upload_sessions || [];
    return sessions.find((s: any) => s.id === sessionId) || null;
  },

  /**
   * Refresh direct upload capability if near expiry
   */
  async refreshCapability(
    sessionId: string,
    workspaceId: string
  ): Promise<DirectUploadCapability> {
    const session = await this.getSessionById(sessionId);
    if (!session) {
      throw AppError.notFound('Upload session not found', ErrorCodes.NOT_FOUND);
    }

    if (session.workspace_id !== workspaceId) {
      throw AppError.forbidden('Forbidden: session belongs to another workspace', ErrorCodes.FORBIDDEN);
    }

    if (session.status !== 'created' && session.status !== 'uploading') {
      throw AppError.badRequest(
        `Cannot refresh capability for session in state "${session.status}"`,
        ErrorCodes.INVALID_STATE
      );
    }

    const storage = getStorageProvider();
    const capability = await storage.createDirectUploadSession({
      key: session.storage_key,
      mimeType: session.mime_type,
      sizeBytes: session.size_bytes,
      expiresInSeconds: 3600,
    });

    return capability;
  },

  /**
   * Finalize an upload session atomically via the finalize_upload_session PostgreSQL RPC
   */
  async completeSession(params: {
    sessionId: string;
    workspaceId: string;
    callerUserId?: string | null;
    callerServiceAccountId?: string | null;
    clientChecksum?: string | null;
  }): Promise<FinalizeSessionResult> {
    assertPersistentBackend('UploadSessionService.completeSession');

    const session = await this.getSessionById(params.sessionId);
    if (!session) {
      throw AppError.notFound('Upload session not found', ErrorCodes.NOT_FOUND);
    }

    if (session.workspace_id !== params.workspaceId) {
      throw AppError.forbidden('Forbidden: session belongs to another workspace', ErrorCodes.FORBIDDEN);
    }

    // Check if session was already completed (idempotent fast path)
    if (session.status === 'completed' && session.asset_id) {
      if (isSupabaseAdminConfigured()) {
        const { data: existingAsset } = await supabaseAdmin
          .from('assets')
          .select('*')
          .eq('id', session.asset_id)
          .maybeSingle();

        const { data: existingJob } = await supabaseAdmin
          .from('processing_jobs')
          .select('*')
          .eq('asset_id', session.asset_id)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (existingAsset) {
          return {
            asset: existingAsset as Asset,
            job: (existingJob as ProcessingJob) || null,
            idempotent: true,
          };
        }
      }
    }

    // Verify object existence and metadata using HEAD via getObjectMetadata()
    // CRITICAL: NEVER download the full media object into Vercel memory!
    const storage = getStorageProvider();
    let metadata: ObjectMetadata | null = null;
    try {
      metadata = await storage.getObjectMetadata(session.storage_key);
    } catch (err: any) {
      throw AppError.badRequest(
        `Failed to verify uploaded object in storage: ${err.message}`,
        ErrorCodes.UPLOAD_VERIFICATION_FAILED
      );
    }

    if (!metadata || metadata.sizeBytes === 0) {
      throw AppError.badRequest(
        'Uploaded file not found in storage. Ensure direct upload completed before finalizing.',
        ErrorCodes.UPLOAD_FILE_NOT_FOUND
      );
    }

    // Call Atomic finalize_upload_session RPC in Supabase PostgreSQL
    if (isSupabaseAdminConfigured()) {
      const { data: rpcResult, error: rpcError } = await (supabaseAdmin.rpc as any)(
        'finalize_upload_session',
        {
          p_session_id: params.sessionId,
          p_workspace_id: params.workspaceId,
          p_caller_user_id: params.callerUserId || null,
          p_caller_service_account_id: params.callerServiceAccountId || null,
          p_actual_size_bytes: metadata.sizeBytes,
          p_declared_checksum: params.clientChecksum || metadata.etag || null,
          p_content_type: metadata.contentType || session.mime_type,
        }
      );

      if (rpcError) {
        throw AppError.internal(
          `Failed to finalize upload session via RPC: ${rpcError.message}`,
          ErrorCodes.DATABASE_ERROR
        );
      }

      if (!rpcResult || !rpcResult.success) {
        const errCode = rpcResult?.error_code || 'FINALIZE_FAILED';
        const errMsg = rpcResult?.message || 'Finalization failed';
        if (errCode === 'SESSION_NOT_FOUND') throw AppError.notFound(errMsg, ErrorCodes.NOT_FOUND);
        if (errCode === 'WORKSPACE_ACCESS_DENIED') throw AppError.forbidden(errMsg, ErrorCodes.FORBIDDEN);
        if (errCode === 'UPLOAD_SESSION_EXPIRED') throw AppError.badRequest(errMsg, ErrorCodes.UPLOAD_SESSION_EXPIRED);
        throw AppError.badRequest(errMsg, errCode);
      }

      return {
        asset: rpcResult.asset as Asset,
        job: (rpcResult.job as ProcessingJob) || null,
        idempotent: Boolean(rpcResult.idempotent),
      };
    }

    // Mock implementation for tests
    const assetId = `med_${Date.now()}`;
    const mockAsset: any = {
      id: assetId,
      workspace_id: params.workspaceId,
      original_filename: session.filename,
      display_name: session.display_name || session.filename,
      mime_type: metadata.contentType || session.mime_type,
      size_bytes: metadata.sizeBytes,
      storage_provider: 'supabase',
      storage_bucket: 'media-assets',
      storage_key: session.storage_key,
      visibility: session.visibility,
      status: 'active',
      processing_status: 'ready',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    session.status = 'completed';
    session.asset_id = assetId;

    return { asset: mockAsset, job: null, idempotent: false };
  },

  /**
   * Safe, recoverable background cleanup for expired upload sessions.
   * CAS transitions session to 'expired_pending_cleanup' before deleting storage.
   */
  async cleanupExpiredSessions(): Promise<{ cleanedCount: number }> {
    if (!isSupabaseAdminConfigured()) return { cleanedCount: 0 };

    const now = new Date().toISOString();
    const storage = getStorageProvider();

    // 1. Find sessions that expired and transition them via CAS
    const { data: expiredSessions, error } = await supabaseAdmin
      .from('upload_sessions')
      .select('id, storage_key')
      .in('status', ['created', 'uploading', 'verifying', 'expired'])
      .lt('expires_at', now)
      .limit(50);

    if (error || !expiredSessions || expiredSessions.length === 0) {
      return { cleanedCount: 0 };
    }

    let cleaned = 0;
    for (const sess of expiredSessions) {
      // CAS step: lock for cleanup
      const { data: updated, error: casError } = await supabaseAdmin
        .from('upload_sessions')
        .update({ status: 'expired_pending_cleanup' })
        .eq('id', sess.id)
        .in('status', ['created', 'uploading', 'verifying', 'expired'])
        .select('id')
        .maybeSingle();

      if (casError || !updated) {
        // Lost race to concurrent finalize or another cleaner
        continue;
      }

      // Delete storage object
      try {
        await storage.delete(sess.storage_key);
      } catch (delError) {
        console.warn(`[Cleanup] Failed to delete storage object for session ${sess.id}:`, delError);
      }

      // Transition to final 'expired' state
      await supabaseAdmin
        .from('upload_sessions')
        .update({ status: 'expired' })
        .eq('id', sess.id);

      cleaned++;
    }

    return { cleanedCount: cleaned };
  },
};
