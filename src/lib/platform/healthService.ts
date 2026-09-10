import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { PLATFORM_VERSION, API_VERSION } from './version';

export interface HealthCheckResult {
  status: 'ok' | 'degraded' | 'failed' | 'not_ready';
  service: string;
  platform_version: string;
  api_version: string;
  timestamp: string;
  checks?: Record<string, any>;
}

export interface RuntimeConfigValidation {
  valid: boolean;
  isProduction: boolean;
  missing: string[];
}

const DB_HEALTH_TIMEOUT_MS = 3000;
const STORAGE_HEALTH_TIMEOUT_MS = 4000;

/**
 * Single Source of Truth for critical platform RPCs and expected minimum argument counts.
 */
export const CRITICAL_PLATFORM_RPCS = [
  { name: 'claim_next_processing_job', minArgs: 2 },
  { name: 'fail_processing_job', minArgs: 4 },
  { name: 'publish_processed_asset', minArgs: 4 },
  { name: 'consume_rate_limit_token', minArgs: 3 },
  { name: 'reserve_idempotency_key', minArgs: 6 },
  { name: 'complete_idempotency_key', minArgs: 4 },
  { name: 'fail_idempotency_key', minArgs: 3 },
  { name: 'renew_idempotency_lease', minArgs: 3 },
] as const;

/**
 * Validate that mandatory production configurations are present.
 * Never leaks secret values.
 */
export function validateRuntimeConfiguration(): RuntimeConfigValidation {
  const isProduction = process.env.NODE_ENV === 'production';
  const missing: string[] = [];

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!process.env.SUPABASE_STORAGE_BUCKET) missing.push('SUPABASE_STORAGE_BUCKET');

  return {
    valid: missing.length === 0,
    isProduction,
    missing,
  };
}

/**
 * Deterministic Health Aggregation: Single source of truth.
 * Evaluates all child subsystem statuses and computes overall service level.
 */
export function aggregateHealthStatus(checks: Record<string, any>): 'ok' | 'degraded' | 'failed' {
  // Critical configuration failure in production
  if (checks.configuration?.status === 'failed') return 'failed';

  // Hard dependency failure (DB or Storage unusable)
  if (checks.database?.status === 'failed') return 'failed';
  if (checks.storage?.status === 'failed') return 'failed';

  // Degraded subsystem conditions:
  // 1. Missing or mismatched critical RPCs
  if (checks.database?.rpc_integrity === 'degraded') return 'degraded';

  // 2. Storage write-read-delete probe failed or degraded
  if (checks.storage?.status === 'degraded') return 'degraded';

  // 3. Queue operational health degraded (DLQ spike or stale queued jobs)
  if (checks.queue?.status === 'degraded') return 'degraded';

  // 4. Stalled queue: Queued jobs exist (>0) but NO workers online
  const queuedCount = Number(checks.queue?.queued) || 0;
  const onlineWorkers = Number(checks.workers?.online_workers) || 0;
  if (queuedCount > 0 && onlineWorkers === 0) {
    return 'degraded';
  }

  return 'ok';
}

async function runWithTimeout<T = any>(
  promiseLike: PromiseLike<T> | Promise<T>,
  timeoutMs: number,
  name: string
): Promise<T> {
  const promise = Promise.resolve(promiseLike);
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${name} health check timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}

export const healthService = {
  /**
   * Liveness Probe: Fast, in-memory process health.
   * Never calls external databases or storage dependencies.
   */
  getLiveness(): HealthCheckResult {
    return {
      status: 'ok',
      service: 'media-platform-api',
      platform_version: PLATFORM_VERSION,
      api_version: API_VERSION,
      timestamp: new Date().toISOString(),
    };
  },

  /**
   * Readiness Probe: Basic dependency connectivity required to accept incoming traffic.
   * In production, requires authentic database and storage connectivity.
   * Returns HTTP 503 if not ready.
   */
  async getReadiness(): Promise<{ isReady: boolean; result: HealthCheckResult }> {
    const timestamp = new Date().toISOString();
    const checks: Record<string, any> = {};
    let isReady = true;

    // 0. Production Configuration Pre-Check
    const configCheck = validateRuntimeConfiguration();
    if (configCheck.isProduction && !configCheck.valid) {
      isReady = false;
      checks.configuration = {
        status: 'failed',
        error: `Production configuration missing required variables: ${configCheck.missing.join(', ')}`,
        missing: configCheck.missing,
      };
    }

    // 1. Database Connectivity Check
    const startDb = Date.now();
    try {
      if (isSupabaseAdminConfigured()) {
        const dbRes = await runWithTimeout<any>(
          Promise.resolve(supabaseAdmin.from('workspaces').select('id').limit(1)),
          DB_HEALTH_TIMEOUT_MS,
          'Database'
        );
        if (dbRes?.error) throw dbRes.error;
        checks.database = {
          status: 'ok',
          latency_ms: Date.now() - startDb,
        };
      } else if (configCheck.isProduction) {
        // In production, unconfigured Supabase is a hard failure
        isReady = false;
        checks.database = {
          status: 'failed',
          error: 'Supabase admin is not configured in production environment',
        };
      } else {
        checks.database = {
          status: 'ok',
          mode: 'mock_memory',
          latency_ms: 1,
        };
      }
    } catch (err: any) {
      isReady = false;
      checks.database = {
        status: 'failed',
        error: err.message,
        latency_ms: Date.now() - startDb,
      };
    }

    // 2. Storage Basic Connectivity Check
    const startStorage = Date.now();
    try {
      if (isSupabaseAdminConfigured()) {
        const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'media-assets';
        const { error } = await runWithTimeout(
          supabaseAdmin.storage.from(bucket).list('', { limit: 1 }),
          STORAGE_HEALTH_TIMEOUT_MS,
          'Storage'
        );
        if (error) throw error;
        checks.storage = {
          status: 'ok',
          latency_ms: Date.now() - startStorage,
        };
      } else if (configCheck.isProduction) {
        isReady = false;
        checks.storage = {
          status: 'failed',
          error: 'Object storage is not configured in production environment',
        };
      } else {
        checks.storage = {
          status: 'ok',
          mode: 'mock_storage',
          latency_ms: 1,
        };
      }
    } catch (err: any) {
      isReady = false;
      checks.storage = {
        status: 'failed',
        error: err.message,
        latency_ms: Date.now() - startStorage,
      };
    }

    return {
      isReady,
      result: {
        status: isReady ? 'ok' : 'not_ready',
        service: 'media-platform-api',
        platform_version: PLATFORM_VERSION,
        api_version: API_VERSION,
        timestamp,
        checks,
      },
    };
  },

  /**
   * Deep Health Check: Full diagnostic check for operators.
   * Performs real Storage Write-Read-Delete probe in `_health/`, verifies critical RPCs via pg_proc signatures,
   * inspects queue depth, and correlates active worker fleet.
   */
  async getDeepHealth(requestId: string): Promise<HealthCheckResult> {
    const timestamp = new Date().toISOString();
    const checks: Record<string, any> = {};

    // 0. Configuration Check
    const configCheck = validateRuntimeConfiguration();
    if (configCheck.isProduction && !configCheck.valid) {
      checks.configuration = {
        status: 'failed',
        missing: configCheck.missing,
      };
    } else {
      checks.configuration = { status: 'ok' };
    }

    // 1. Deep Database Check + Critical RPC verification
    const startDb = Date.now();
    try {
      if (isSupabaseAdminConfigured()) {
        // Non-mutating verification of all critical platform RPCs via pg_proc metadata and signature
        const rpcCheck = await runWithTimeout<any>(
          Promise.resolve(supabaseAdmin.rpc('verify_platform_rpcs')),
          DB_HEALTH_TIMEOUT_MS,
          'Platform RPCs Probe'
        );

        const rpcResults = rpcCheck?.data || {};
        const allAvailable =
          !rpcCheck?.error &&
          Object.keys(rpcResults).length > 0 &&
          Object.values(rpcResults).every((v) => v === 'available');

        checks.database = {
          status: 'ok',
          latency_ms: Date.now() - startDb,
          rpcs: rpcResults,
          rpc_integrity: allAvailable ? 'verified' : 'degraded',
        };
      } else if (configCheck.isProduction) {
        checks.database = { status: 'failed', error: 'Database unconfigured in production' };
      } else {
        checks.database = { status: 'ok', mode: 'mock_memory', latency_ms: 1, rpc_integrity: 'verified' };
      }
    } catch (err: any) {
      checks.database = { status: 'failed', error: err.message, latency_ms: Date.now() - startDb };
    }

    // 2. Deep Storage Check: Write-Read-Delete Probe
    const startStorage = Date.now();
    const probeKey = `_health/probe_${requestId}.txt`;
    const probeContent = Buffer.from(`health_probe_${Date.now()}`);
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'media-assets';

    try {
      if (isSupabaseAdminConfigured()) {
        // Write
        const uploadRes = await runWithTimeout(
          supabaseAdmin.storage.from(bucket).upload(probeKey, probeContent, { upsert: true, contentType: 'text/plain' }),
          STORAGE_HEALTH_TIMEOUT_MS,
          'Storage Write Probe'
        );
        if (uploadRes.error) throw uploadRes.error;

        // Read
        const downloadRes = await runWithTimeout(
          supabaseAdmin.storage.from(bucket).download(probeKey),
          STORAGE_HEALTH_TIMEOUT_MS,
          'Storage Read Probe'
        );
        if (downloadRes.error) throw downloadRes.error;

        // Delete (Cleanup)
        await supabaseAdmin.storage.from(bucket).remove([probeKey]).catch(() => {});

        checks.storage = {
          status: 'ok',
          probe: 'write_read_delete_verified',
          latency_ms: Date.now() - startStorage,
        };
      } else if (configCheck.isProduction) {
        checks.storage = { status: 'failed', error: 'Storage unconfigured in production' };
      } else {
        checks.storage = { status: 'ok', mode: 'mock_storage', latency_ms: 2 };
      }
    } catch (err: any) {
      checks.storage = { status: 'failed', error: err.message, latency_ms: Date.now() - startStorage };
      if (isSupabaseAdminConfigured()) {
        supabaseAdmin.storage.from(bucket).remove([probeKey]).catch(() => {});
      }
    }

    // 3. Queue Operational Health
    try {
      if (isSupabaseAdminConfigured()) {
        const { data: jobs } = await supabaseAdmin
          .from('processing_jobs')
          .select('status, created_at')
          .in('status', ['queued', 'processing', 'retrying', 'dead_letter']);

        const jobList = jobs || [];
        const queuedCount = jobList.filter((j) => j.status === 'queued').length;
        const processingCount = jobList.filter((j) => j.status === 'processing').length;
        const retryingCount = jobList.filter((j) => j.status === 'retrying').length;
        const dlqCount = jobList.filter((j) => j.status === 'dead_letter').length;

        let oldestQueuedAgeSec = 0;
        const queuedJobs = jobList.filter((j) => j.status === 'queued');
        if (queuedJobs.length > 0) {
          const oldestTime = Math.min(...queuedJobs.map((j) => new Date(j.created_at).getTime()));
          oldestQueuedAgeSec = Math.max(0, Math.floor((Date.now() - oldestTime) / 1000));
        }

        checks.queue = {
          status: dlqCount > 10 || oldestQueuedAgeSec > 300 ? 'degraded' : 'ok',
          queued: queuedCount,
          processing: processingCount,
          retrying: retryingCount,
          dead_letter: dlqCount,
          oldest_queued_age_seconds: oldestQueuedAgeSec,
        };
      } else {
        checks.queue = { status: 'ok', queued: 0, processing: 0, retrying: 0, dead_letter: 0 };
      }
    } catch (err: any) {
      checks.queue = { status: 'unknown', error: err.message };
    }

    // 4. Worker Fleet Health
    try {
      if (isSupabaseAdminConfigured()) {
        const staleThreshold = new Date(Date.now() - 60000).toISOString();
        const { data: workers } = await supabaseAdmin.from('worker_instances').select('*');

        const workerList = workers || [];
        const onlineCount = workerList.filter((w) => w.last_heartbeat_at >= staleThreshold).length;
        const staleCount = workerList.filter((w) => w.last_heartbeat_at < staleThreshold).length;

        checks.workers = {
          status: onlineCount > 0 ? 'ok' : 'warning',
          online_workers: onlineCount,
          stale_workers: staleCount,
        };
      } else {
        checks.workers = { status: 'ok', online_workers: 1, stale_workers: 0 };
      }
    } catch (err: any) {
      checks.workers = { status: 'unknown', error: err.message };
    }

    // Single source of truth deterministic aggregation
    const overallStatus = aggregateHealthStatus(checks);

    return {
      status: overallStatus,
      service: 'media-platform-api',
      platform_version: PLATFORM_VERSION,
      api_version: API_VERSION,
      timestamp,
      checks,
    };
  },
};
