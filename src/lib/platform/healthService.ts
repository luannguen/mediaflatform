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

const DB_HEALTH_TIMEOUT_MS = 3000;
const STORAGE_HEALTH_TIMEOUT_MS = 4000;

async function runWithTimeout<T = any>(promiseLike: PromiseLike<T> | Promise<T>, timeoutMs: number, name: string): Promise<T> {
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
   * Checks PostgreSQL and Object Storage access. Returns HTTP 503 if not ready.
   */
  async getReadiness(): Promise<{ isReady: boolean; result: HealthCheckResult }> {
    const timestamp = new Date().toISOString();
    const checks: Record<string, any> = {};
    let isReady = true;

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
      }
      checks.database = {
        status: 'ok',
        latency_ms: Date.now() - startDb,
      };
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
      }
      checks.storage = {
        status: 'ok',
        latency_ms: Date.now() - startStorage,
      };
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
   * Performs real Storage Write-Read-Delete probe in `_health/`, verifies critical RPCs,
   * inspects queue depth, and checks active worker fleet.
   */
  async getDeepHealth(requestId: string): Promise<HealthCheckResult> {
    const timestamp = new Date().toISOString();
    const checks: Record<string, any> = {};
    let overallStatus: 'ok' | 'degraded' | 'failed' = 'ok';

    // 1. Deep Database Check + Critical RPC verification
    const startDb = Date.now();
    try {
      if (isSupabaseAdminConfigured()) {
        // Non-mutating verification of all critical platform RPCs via pg_proc metadata
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

        if (!allAvailable) {
          overallStatus = 'degraded';
        }

        checks.database = {
          status: 'ok',
          latency_ms: Date.now() - startDb,
          rpcs: rpcResults,
          rpc_integrity: allAvailable ? 'verified' : 'degraded',
        };
      } else {
        checks.database = { status: 'ok', mode: 'mock_memory', latency_ms: 1, rpc_integrity: 'verified' };
      }
    } catch (err: any) {
      overallStatus = 'degraded';
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
      } else {
        checks.storage = { status: 'ok', mode: 'mock_storage', latency_ms: 2 };
      }
    } catch (err: any) {
      overallStatus = 'degraded';
      checks.storage = { status: 'failed', error: err.message, latency_ms: Date.now() - startStorage };
      // Attempt cleanup even on failure
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
