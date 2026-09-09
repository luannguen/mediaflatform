import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { mockDb, mockWorkspace } from '@/lib/mock/store';
import { generateId } from '@/lib/ids/generator';
import {
  ProcessingJob,
  JobType,
  JobStatus,
  JobStage,
  ErrorTaxonomy,
} from '@/types/database';
import { AppError } from '@/lib/errors/app-error';

export const BACKOFF_SCHEDULE_MS = [
  30 * 1000,   // Attempt 1: +30s
  120 * 1000,  // Attempt 2: +2m
  600 * 1000,  // Attempt 3: +10m
];

export const RETRYABLE_ERRORS = new Set<string>([
  'STORAGE_TIMEOUT',
  'NETWORK_ERROR',
  'WORKER_INTERRUPTED',
  'TEMPORARY_IO_ERROR',
  'RATE_LIMITED',
]);

export const PERMANENT_ERRORS = new Set<string>([
  'INVALID_VIDEO',
  'CORRUPTED_SOURCE',
  'UNSUPPORTED_CODEC',
  'INVALID_CONTAINER',
  'SOURCE_NOT_FOUND',
  'HLS_VALIDATION_FAILED',
]);

export class LeaseLostError extends Error {
  constructor(message: string = 'LEASE_LOST: Job lease expired or reclaimed by another worker') {
    super(message);
    this.name = 'LeaseLostError';
  }
}

export interface LeaseContext {
  workerId: string;
  runId?: string;
}

export interface EnqueueJobInput {
  assetId: string;
  workspaceId?: string;
  jobType: JobType;
  sourceStorageKey: string;
  sourceStorageUrl?: string | null;
  targetProfiles?: string[];
  priority?: number;
  maxAttempts?: number;
  metadata?: Record<string, any>;
}

export interface QueueMetrics {
  total: number;
  queued: number;
  processing: number;
  retrying: number;
  dead_letter: number;
  completed: number;
  failed: number;
  active_leases: number;
}

export const jobQueueService = {
  /**
   * Enqueue a new asynchronous background processing job
   */
  async enqueueJob(input: EnqueueJobInput): Promise<ProcessingJob> {
    const id = generateId('job');
    const now = new Date().toISOString();
    const workspaceId = input.workspaceId || mockWorkspace.id;

    const job: ProcessingJob = {
      id,
      asset_id: input.assetId,
      workspace_id: workspaceId,
      job_type: input.jobType,
      status: 'queued',
      current_stage: 'queued',
      progress: 0,
      source_storage_key: input.sourceStorageKey,
      source_storage_url: input.sourceStorageUrl || null,
      target_profiles: input.targetProfiles || [],
      priority: input.priority ?? 5,
      attempt: 1,
      max_attempts: input.maxAttempts ?? 3,
      locked_by: null,
      locked_at: null,
      lease_expires_at: null,
      heartbeat_at: now,
      available_at: now,
      job_run_id: null,
      output_version: null,
      started_at: null,
      completed_at: null,
      error_code: null,
      error_taxonomy: null,
      error_message: null,
      error_details: {},
      metadata_json: input.metadata || {},
      created_at: now,
      updated_at: now,
    };

    if (!isSupabaseAdminConfigured()) {
      mockDb.processingJobs.unshift(job);
      return job;
    }

    const { data, error } = await supabaseAdmin
      .from('processing_jobs')
      .insert(job)
      .select()
      .single();

    if (error || !data) {
      throw AppError.internal(`Failed to enqueue processing job: ${error?.message || 'Unknown database error'}`);
    }

    return data as ProcessingJob;
  },

  /**
   * Atomically claim next available job in priority queue with lease locking
   * Anti-race condition guaranteed via PostgreSQL FOR UPDATE SKIP LOCKED
   */
  async claimNextJob(
    workerId: string = 'worker_default',
    leaseSeconds: number = 300,
    jobRunId?: string
  ): Promise<ProcessingJob | null> {
    const now = new Date().toISOString();
    const runId = jobRunId || generateId('run');

    if (!isSupabaseAdminConfigured()) {
      const nowTime = Date.now();
      // Candidate: queued/retrying (available_at <= now) OR expired processing lease
      const candidate = mockDb.processingJobs
        .filter((j) => {
          const isQueued = (j.status === 'queued' || j.status === 'retrying') &&
            (!j.available_at || new Date(j.available_at).getTime() <= nowTime);
          const isLeaseExpired = j.status === 'processing' &&
            j.lease_expires_at && new Date(j.lease_expires_at).getTime() < nowTime;
          return isQueued || isLeaseExpired;
        })
        .sort((a, b) => b.priority - a.priority || new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];

      if (!candidate) return null;

      candidate.status = 'processing';
      candidate.current_stage = 'probing';
      candidate.locked_by = workerId;
      candidate.locked_at = now;
      candidate.heartbeat_at = now;
      candidate.lease_expires_at = new Date(nowTime + leaseSeconds * 1000).toISOString();
      candidate.job_run_id = runId;
      candidate.started_at = candidate.started_at || now;
      candidate.updated_at = now;
      candidate.metadata_json = { ...(candidate.metadata_json || {}), worker_id: workerId };

      return candidate;
    }

    // Call PostgreSQL RPC with FOR UPDATE SKIP LOCKED
    try {
      const { data, error } = await supabaseAdmin.rpc('claim_next_processing_job', {
        p_worker_id: workerId,
        p_lease_seconds: leaseSeconds,
        p_job_run_id: runId,
      });

      if (error) {
        console.warn('[JobQueue] RPC claim error, falling back to atomic query:', error.message);
        return await this.fallbackAtomicClaim(workerId, leaseSeconds, runId);
      }

      if (Array.isArray(data) && data.length > 0) {
        return data[0] as ProcessingJob;
      }
      return null;
    } catch (err: any) {
      console.warn('[JobQueue] RPC invocation failed, fallback to query:', err.message);
      return await this.fallbackAtomicClaim(workerId, leaseSeconds, runId);
    }
  },

  /**
   * Fallback query-based claim if RPC is unavailable
   */
  async fallbackAtomicClaim(
    workerId: string,
    leaseSeconds: number,
    runId: string
  ): Promise<ProcessingJob | null> {
    const now = new Date().toISOString();
    const leaseExpiry = new Date(Date.now() + leaseSeconds * 1000).toISOString();

    const { data: candidates, error: fetchErr } = await supabaseAdmin
      .from('processing_jobs')
      .select('*')
      .in('status', ['queued', 'retrying'])
      .lte('available_at', now)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1);

    if (fetchErr || !candidates || candidates.length === 0) {
      return null;
    }

    const candidate = candidates[0];
    const { data: claimed, error: updateErr } = await supabaseAdmin
      .from('processing_jobs')
      .update({
        status: 'processing',
        current_stage: 'probing',
        locked_by: workerId,
        locked_at: now,
        heartbeat_at: now,
        lease_expires_at: leaseExpiry,
        job_run_id: runId,
        started_at: candidate.started_at || now,
        updated_at: now,
        metadata_json: { ...(candidate.metadata_json || {}), worker_id: workerId },
      })
      .eq('id', candidate.id)
      .in('status', ['queued', 'retrying'])
      .select()
      .maybeSingle();

    if (updateErr || !claimed) {
      return null; // Won by another worker
    }

    return claimed as ProcessingJob;
  },

  /**
   * Renew worker lease heartbeat to prevent timeout reclaim
   */
  async renewHeartbeat(
    jobId: string,
    workerId: string,
    runId?: string,
    leaseSeconds: number = 300
  ): Promise<boolean> {
    const now = new Date().toISOString();
    const leaseExpiry = new Date(Date.now() + leaseSeconds * 1000).toISOString();

    if (!isSupabaseAdminConfigured()) {
      const job = mockDb.processingJobs.find((j) => j.id === jobId);
      if (!job || job.status !== 'processing') return false;
      if (job.locked_by && job.locked_by !== workerId) return false;
      if (runId && job.job_run_id && job.job_run_id !== runId) return false;
      if (job.lease_expires_at && new Date(job.lease_expires_at).getTime() < Date.now()) return false;

      job.heartbeat_at = now;
      job.lease_expires_at = leaseExpiry;
      job.updated_at = now;
      return true;
    }

    try {
      const { data, error } = await supabaseAdmin.rpc('renew_job_heartbeat', {
        p_job_id: jobId,
        p_worker_id: workerId,
        p_lease_seconds: leaseSeconds,
        p_job_run_id: runId || null,
      });

      if (!error && typeof data === 'boolean') {
        return data;
      }
    } catch {
      // Fallback below
    }

    // Direct update fallback with fencing
    let query = supabaseAdmin
      .from('processing_jobs')
      .update({
        heartbeat_at: now,
        lease_expires_at: leaseExpiry,
        updated_at: now,
      })
      .eq('id', jobId)
      .eq('status', 'processing')
      .eq('locked_by', workerId)
      .gt('lease_expires_at', now);

    if (runId) {
      query = query.eq('job_run_id', runId);
    }

    const { data: updated } = await query.select('id').maybeSingle();
    return !!updated;
  },

  /**
   * Update progress, current stage, and heartbeat with Fencing
   */
  async updateJobProgress(
    jobId: string,
    stage: JobStage,
    progress: number,
    metadata?: Record<string, any>,
    leaseContext?: LeaseContext
  ): Promise<ProcessingJob> {
    const now = new Date().toISOString();
    const clampedProgress = Math.max(0, Math.min(100, Math.round(progress)));

    if (!isSupabaseAdminConfigured()) {
      const job = mockDb.processingJobs.find((j) => j.id === jobId);
      if (!job) throw AppError.notFound(`Job ${jobId} not found`);

      if (leaseContext) {
        if (job.locked_by && job.locked_by !== leaseContext.workerId) {
          throw new LeaseLostError(`LEASE_LOST: Job ${jobId} locked by ${job.locked_by}, not ${leaseContext.workerId}`);
        }
        if (leaseContext.runId && job.job_run_id && job.job_run_id !== leaseContext.runId) {
          throw new LeaseLostError(`LEASE_LOST: Job run ID mismatch for ${jobId}`);
        }
        if (job.lease_expires_at && new Date(job.lease_expires_at).getTime() < Date.now()) {
          throw new LeaseLostError(`LEASE_LOST: Job lease expired for ${jobId}`);
        }
      }

      job.current_stage = stage;
      job.progress = clampedProgress;
      job.heartbeat_at = now;
      job.updated_at = now;
      if (metadata) {
        job.metadata_json = { ...(job.metadata_json || {}), ...metadata };
      }
      return job;
    }

    let query = supabaseAdmin
      .from('processing_jobs')
      .update({
        current_stage: stage,
        progress: clampedProgress,
        heartbeat_at: now,
        updated_at: now,
        ...(metadata ? { metadata_json: metadata } : {}),
      })
      .eq('id', jobId)
      .eq('status', 'processing');

    if (leaseContext) {
      query = query
        .eq('locked_by', leaseContext.workerId)
        .gt('lease_expires_at', now);
      if (leaseContext.runId) {
        query = query.eq('job_run_id', leaseContext.runId);
      }
    }

    const { data, error } = await query.select().maybeSingle();

    if (error || !data) {
      if (leaseContext) {
        throw new LeaseLostError(`LEASE_LOST: Fencing failed for job ${jobId}`);
      }
      throw AppError.internal(`Failed to update job progress: ${error?.message || 'Job not in processing state'}`);
    }

    return data as ProcessingJob;
  },

  /**
   * Mark job completed and persist output manifest with Fencing Token
   */
  async completeJob(
    jobId: string,
    outputManifest: Record<string, any>,
    outputVersion?: string,
    leaseContext?: LeaseContext
  ): Promise<ProcessingJob> {
    const now = new Date().toISOString();
    const version = outputVersion || `v1_${Date.now()}`;

    if (!isSupabaseAdminConfigured()) {
      const job = mockDb.processingJobs.find((j) => j.id === jobId);
      if (!job) throw AppError.notFound(`Job ${jobId} not found`);

      if (leaseContext) {
        if (job.locked_by && job.locked_by !== leaseContext.workerId) {
          throw new LeaseLostError(`LEASE_LOST: Job ${jobId} locked by ${job.locked_by}, not ${leaseContext.workerId}`);
        }
        if (leaseContext.runId && job.job_run_id && job.job_run_id !== leaseContext.runId) {
          throw new LeaseLostError(`LEASE_LOST: Job run ID mismatch for ${jobId}`);
        }
        if (job.lease_expires_at && new Date(job.lease_expires_at).getTime() < Date.now()) {
          throw new LeaseLostError(`LEASE_LOST: Job lease expired for ${jobId}`);
        }
      }

      job.status = 'completed';
      job.current_stage = 'ready';
      job.progress = 100;
      job.output_version = version;
      job.completed_at = now;
      job.heartbeat_at = now;
      job.lease_expires_at = null;
      job.updated_at = now;
      job.metadata_json = {
        ...(job.metadata_json || {}),
        output_manifest: outputManifest,
      };

      // Update parent asset
      const asset = mockDb.assets.find((a) => a.id === job.asset_id);
      if (asset) {
        asset.processing_status = 'ready';
        asset.updated_at = now;
        asset.metadata_json = {
          ...(asset.metadata_json || {}),
          hls: outputManifest,
          active_output_version: version,
        };
      }
      return job;
    }

    let query = supabaseAdmin
      .from('processing_jobs')
      .update({
        status: 'completed',
        current_stage: 'ready',
        progress: 100,
        output_version: version,
        completed_at: now,
        heartbeat_at: now,
        lease_expires_at: null,
        updated_at: now,
        metadata_json: { output_manifest: outputManifest },
      })
      .eq('id', jobId)
      .eq('status', 'processing');

    if (leaseContext) {
      query = query
        .eq('locked_by', leaseContext.workerId)
        .gt('lease_expires_at', now);
      if (leaseContext.runId) {
        query = query.eq('job_run_id', leaseContext.runId);
      }
    }

    const { data: job, error } = await query.select().maybeSingle();

    if (error || !job) {
      if (leaseContext) {
        throw new LeaseLostError(`LEASE_LOST: Fencing failed for job ${jobId} upon completion`);
      }
      throw AppError.internal(`Failed to complete job: ${error?.message || 'Job not in processing state'}`);
    }

    // Update parent asset ONLY after verified fenced completion
    const { data: existingAsset } = await supabaseAdmin
      .from('assets')
      .select('metadata_json')
      .eq('id', job.asset_id)
      .maybeSingle();

    const mergedMetadata = {
      ...(existingAsset?.metadata_json || {}),
      hls: outputManifest,
      active_output_version: version,
    };

    await supabaseAdmin
      .from('assets')
      .update({
        processing_status: 'ready',
        metadata_json: mergedMetadata,
        updated_at: now,
      })
      .eq('id', job.asset_id);

    return job as ProcessingJob;
  },

  /**
   * Record failure with Retry Taxonomy and Exponential Backoff or Dead Letter Queue with Fencing
   */
  async failJob(
    jobId: string,
    errorCode: string,
    errorMessage: string,
    retryable: boolean = true,
    errorDetails: Record<string, any> = {},
    leaseContext?: LeaseContext
  ): Promise<ProcessingJob> {
    const now = new Date().toISOString();
    const isPermanent = PERMANENT_ERRORS.has(errorCode);
    const isExplicitRetryable = retryable && !isPermanent;

    if (!isSupabaseAdminConfigured()) {
      const job = mockDb.processingJobs.find((j) => j.id === jobId);
      if (!job) throw AppError.notFound(`Job ${jobId} not found`);

      if (leaseContext) {
        if (job.locked_by && job.locked_by !== leaseContext.workerId) {
          throw new LeaseLostError(`LEASE_LOST: Job ${jobId} locked by ${job.locked_by}, not ${leaseContext.workerId}`);
        }
        if (leaseContext.runId && job.job_run_id && job.job_run_id !== leaseContext.runId) {
          throw new LeaseLostError(`LEASE_LOST: Job run ID mismatch for ${jobId}`);
        }
      }

      const canRetry = isExplicitRetryable && job.attempt < job.max_attempts;

      if (canRetry) {
        const backoffMs = BACKOFF_SCHEDULE_MS[job.attempt - 1] || 600000;
        const availableAt = new Date(Date.now() + backoffMs).toISOString();

        job.attempt += 1;
        job.status = 'retrying';
        job.current_stage = 'queued';
        job.available_at = availableAt;
        job.locked_by = null;
        job.locked_at = null;
        job.lease_expires_at = null;
        job.error_code = errorCode;
        job.error_taxonomy = errorCode as ErrorTaxonomy;
        job.error_message = `Attempt ${job.attempt - 1} failed: ${errorMessage}`;
        job.error_details = errorDetails;
        job.updated_at = now;
      } else {
        // Dead Letter Queue
        job.status = 'dead_letter';
        job.error_code = errorCode;
        job.error_taxonomy = errorCode as ErrorTaxonomy;
        job.error_message = errorMessage;
        job.error_details = errorDetails;
        job.completed_at = now;
        job.locked_by = null;
        job.lease_expires_at = null;
        job.updated_at = now;

        const asset = mockDb.assets.find((a) => a.id === job.asset_id);
        if (asset) asset.processing_status = 'failed';
      }
      return job;
    }

    const current = await this.getJobById(jobId);
    if (!current) throw AppError.notFound(`Job ${jobId} not found`);

    const canRetry = isExplicitRetryable && current.attempt < current.max_attempts;
    const nextStatus: JobStatus = canRetry ? 'retrying' : 'dead_letter';
    const nextStage: JobStage = canRetry ? 'queued' : current.current_stage;
    const nextAttempt = canRetry ? current.attempt + 1 : current.attempt;

    const backoffMs = canRetry ? (BACKOFF_SCHEDULE_MS[current.attempt - 1] || 600000) : 0;
    const availableAt = canRetry ? new Date(Date.now() + backoffMs).toISOString() : now;

    let query = supabaseAdmin
      .from('processing_jobs')
      .update({
        status: nextStatus,
        current_stage: nextStage,
        attempt: nextAttempt,
        available_at: availableAt,
        locked_by: null,
        locked_at: null,
        lease_expires_at: null,
        error_code: errorCode,
        error_taxonomy: errorCode,
        error_message: errorMessage,
        error_details: errorDetails,
        completed_at: canRetry ? null : now,
        updated_at: now,
      })
      .eq('id', jobId);

    if (leaseContext) {
      query = query.eq('locked_by', leaseContext.workerId);
      if (leaseContext.runId) {
        query = query.eq('job_run_id', leaseContext.runId);
      }
    }

    const { data, error } = await query.select().maybeSingle();

    if (error || !data) {
      if (leaseContext) {
        throw new LeaseLostError(`LEASE_LOST: Fencing failed for failJob on ${jobId}`);
      }
      throw AppError.internal(`Failed to record job failure: ${error?.message || 'Unknown error'}`);
    }

    if (!canRetry) {
      await supabaseAdmin
        .from('assets')
        .update({ processing_status: 'failed', updated_at: now })
        .eq('id', current.asset_id);
    }

    return data as ProcessingJob;
  },

  /**
   * Manual retry triggered by User or Admin (can resurrect from dead_letter or failed)
   */
  async retryJob(jobId: string, resetAttempts: boolean = false): Promise<ProcessingJob> {
    const now = new Date().toISOString();

    if (!isSupabaseAdminConfigured()) {
      const job = mockDb.processingJobs.find((j) => j.id === jobId);
      if (!job) throw AppError.notFound(`Job ${jobId} not found`);

      job.status = 'queued';
      job.current_stage = 'queued';
      job.progress = 0;
      job.attempt = resetAttempts ? 1 : job.attempt + 1;
      job.available_at = now;
      job.locked_by = null;
      job.locked_at = null;
      job.lease_expires_at = null;
      job.error_code = null;
      job.error_taxonomy = null;
      job.error_message = null;
      job.error_details = {};
      job.started_at = null;
      job.completed_at = null;
      job.updated_at = now;

      const asset = mockDb.assets.find((a) => a.id === job.asset_id);
      if (asset) asset.processing_status = 'pending';

      return job;
    }

    const current = await this.getJobById(jobId);
    if (!current) throw AppError.notFound(`Job ${jobId} not found`);

    const nextAttempt = resetAttempts ? 1 : (current.attempt || 1) + 1;

    const { data, error } = await supabaseAdmin
      .from('processing_jobs')
      .update({
        status: 'queued',
        current_stage: 'queued',
        progress: 0,
        attempt: nextAttempt,
        available_at: now,
        locked_by: null,
        locked_at: null,
        lease_expires_at: null,
        error_code: null,
        error_taxonomy: null,
        error_message: null,
        error_details: {},
        started_at: null,
        completed_at: null,
        updated_at: now,
      })
      .eq('id', jobId)
      .select()
      .single();

    if (error || !data) {
      throw AppError.internal(`Failed to retry job: ${error?.message || 'Unknown error'}`);
    }

    await supabaseAdmin
      .from('assets')
      .update({ processing_status: 'pending', updated_at: now })
      .eq('id', (data as ProcessingJob).asset_id);

    return data as ProcessingJob;
  },

  async getJobById(jobId: string): Promise<ProcessingJob | null> {
    if (!isSupabaseAdminConfigured()) {
      return mockDb.processingJobs.find((j) => j.id === jobId) || null;
    }

    const { data, error } = await supabaseAdmin
      .from('processing_jobs')
      .select('*')
      .eq('id', jobId)
      .maybeSingle();

    if (error) return null;
    return (data as ProcessingJob) || null;
  },

  async getJobByAssetId(assetId: string): Promise<ProcessingJob | null> {
    if (!isSupabaseAdminConfigured()) {
      return (
        mockDb.processingJobs
          .filter((j) => j.asset_id === assetId)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] || null
      );
    }

    const { data, error } = await supabaseAdmin
      .from('processing_jobs')
      .select('*')
      .eq('asset_id', assetId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return null;
    return (data as ProcessingJob) || null;
  },

  async listJobs(
    workspaceId: string = mockWorkspace.id,
    status?: JobStatus,
    limit: number = 50
  ): Promise<ProcessingJob[]> {
    if (!isSupabaseAdminConfigured()) {
      let jobs = mockDb.processingJobs.filter((j) => j.workspace_id === workspaceId);
      if (status) jobs = jobs.filter((j) => j.status === status);
      return jobs.slice(0, limit);
    }

    let query = supabaseAdmin
      .from('processing_jobs')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw AppError.internal(`Failed to list jobs: ${error.message}`);
    return (data as ProcessingJob[]) || [];
  },

  /**
   * List jobs in Dead Letter Queue (DLQ) for investigation
   */
  async listDeadLetterJobs(
    workspaceId: string = mockWorkspace.id,
    limit: number = 50
  ): Promise<ProcessingJob[]> {
    return await this.listJobs(workspaceId, 'dead_letter', limit);
  },

  /**
   * Get queue health metrics for operations monitoring
   */
  async getQueueMetrics(workspaceId: string = mockWorkspace.id): Promise<QueueMetrics> {
    if (!isSupabaseAdminConfigured()) {
      const jobs = mockDb.processingJobs.filter((j) => j.workspace_id === workspaceId);
      const nowTime = Date.now();
      return {
        total: jobs.length,
        queued: jobs.filter((j) => j.status === 'queued').length,
        processing: jobs.filter((j) => j.status === 'processing').length,
        retrying: jobs.filter((j) => j.status === 'retrying').length,
        dead_letter: jobs.filter((j) => j.status === 'dead_letter').length,
        completed: jobs.filter((j) => j.status === 'completed').length,
        failed: jobs.filter((j) => j.status === 'failed').length,
        active_leases: jobs.filter(
          (j) => j.status === 'processing' && j.lease_expires_at && new Date(j.lease_expires_at).getTime() > nowTime
        ).length,
      };
    }

    const { data: jobs, error } = await supabaseAdmin
      .from('processing_jobs')
      .select('status, lease_expires_at')
      .eq('workspace_id', workspaceId);

    if (error || !jobs) {
      return {
        total: 0,
        queued: 0,
        processing: 0,
        retrying: 0,
        dead_letter: 0,
        completed: 0,
        failed: 0,
        active_leases: 0,
      };
    }

    const nowTime = Date.now();
    return {
      total: jobs.length,
      queued: jobs.filter((j) => j.status === 'queued').length,
      processing: jobs.filter((j) => j.status === 'processing').length,
      retrying: jobs.filter((j) => j.status === 'retrying').length,
      dead_letter: jobs.filter((j) => j.status === 'dead_letter').length,
      completed: jobs.filter((j) => j.status === 'completed').length,
      failed: jobs.filter((j) => j.status === 'failed').length,
      active_leases: jobs.filter(
        (j) => j.status === 'processing' && j.lease_expires_at && new Date(j.lease_expires_at).getTime() > nowTime
      ).length,
    };
  },
};
