import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { WorkerInstance } from '@/types/database';
import { PLATFORM_VERSION } from '@/lib/platform/version';
import os from 'os';

// In-memory fallback for testing & local development
const inMemoryWorkers = new Map<string, WorkerInstance>();

const STALE_THRESHOLD_SECONDS = 60;

export const workerFleetService = {
  /**
   * Register or update worker instance upon process startup
   */
  async registerWorker(params: {
    workerId?: string;
    worker_id?: string;
    hostname?: string;
    pid?: number;
    job_types?: string[];
    instanceId?: string;
    capabilities?: Record<string, any>;
    runtimeInfo?: Record<string, any>;
  }): Promise<WorkerInstance> {
    const workerId = params.workerId || params.worker_id || `worker_${Date.now()}`;
    const now = new Date().toISOString();
    const instanceId = params.instanceId || `inst_${Date.now().toString(36)}_${params.pid || process.pid}`;

    const record: WorkerInstance = {
      id: `winst_${workerId}`,
      worker_id: workerId,
      instance_id: instanceId,
      version: PLATFORM_VERSION,
      hostname: params.hostname || os.hostname(),
      started_at: now,
      last_heartbeat_at: now,
      status: 'online',
      current_job_id: null,
      capabilities: {
        processors: params.job_types || ['image_optimization', 'transcode_video', 'document_extract'],
        supported_formats: ['jpeg', 'png', 'webp', 'avif', 'mp4', 'pdf'],
        max_concurrency: 4,
        ...(params.capabilities || {}),
      },
      runtime_info: {
        node_version: process.version,
        os: `${os.type()} ${os.release()}`,
        pid: params.pid || process.pid,
        ...(params.runtimeInfo || {}),
      },
      created_at: now,
      updated_at: now,
    };

    inMemoryWorkers.set(workerId, record);

    if (isSupabaseAdminConfigured()) {
      try {
        await supabaseAdmin.from('worker_instances').upsert(record, {
          onConflict: 'id',
        });
      } catch (err: any) {
        console.warn('[WorkerFleetService] Failed to register worker:', err.message);
      }
    }

    return record;
  },

  /**
   * Periodic heartbeat from running worker daemon
   */
  async heartbeat(workerId: string, status: 'online' | 'busy' = 'online', currentJobId?: string | null): Promise<void> {
    const now = new Date().toISOString();
    const mem = inMemoryWorkers.get(workerId);
    if (mem) {
      mem.last_heartbeat_at = now;
      mem.status = status;
      mem.current_job_id = currentJobId || null;
      mem.updated_at = now;
    }

    if (isSupabaseAdminConfigured()) {
      try {
        await supabaseAdmin
          .from('worker_instances')
          .update({
            last_heartbeat_at: now,
            status,
            current_job_id: currentJobId || null,
            updated_at: now,
          })
          .eq('worker_id', workerId);
      } catch (err: any) {
        console.warn('[WorkerFleetService] Heartbeat update failed:', err.message);
      }
    }
  },

  /**
   * List all registered worker instances with live stale detection
   */
  async listWorkers(): Promise<WorkerInstance[]> {
    const staleCutoff = new Date(Date.now() - STALE_THRESHOLD_SECONDS * 1000).toISOString();

    if (!isSupabaseAdminConfigured()) {
      const list = Array.from(inMemoryWorkers.values());
      return list.map((w) => {
        if (w.status !== 'offline' && w.last_heartbeat_at < staleCutoff) {
          return { ...w, status: 'stale' };
        }
        return w;
      });
    }

    const { data, error } = await supabaseAdmin
      .from('worker_instances')
      .select('*')
      .order('last_heartbeat_at', { ascending: false });

    if (error || !data) return [];

    return (data as WorkerInstance[]).map((w) => {
      if (w.status !== 'offline' && w.last_heartbeat_at < staleCutoff) {
        return { ...w, status: 'stale' };
      }
      return w;
    });
  },

  /**
   * Deregister worker on clean shutdown
   */
  async deregisterWorker(workerId: string): Promise<void> {
    const now = new Date().toISOString();
    const mem = inMemoryWorkers.get(workerId);
    if (mem) {
      mem.status = 'offline';
      mem.updated_at = now;
    }

    if (isSupabaseAdminConfigured()) {
      try {
        await supabaseAdmin
          .from('worker_instances')
          .update({ status: 'offline', updated_at: now })
          .eq('worker_id', workerId);
      } catch (err: any) {
        console.warn('[WorkerFleetService] Deregister failed:', err.message);
      }
    }
  },

  async recordHeartbeat(
    workerId: string,
    params?: { current_job_id?: string | null; increment_completed?: number; status?: 'online' | 'busy' }
  ): Promise<void> {
    const mem = inMemoryWorkers.get(workerId);
    if (mem && params?.increment_completed) {
      mem.completed_jobs_count = (mem.completed_jobs_count || 0) + params.increment_completed;
    }
    return this.heartbeat(workerId, params?.status || 'online', params?.current_job_id);
  },

  async unregisterWorker(workerId: string): Promise<void> {
    return this.deregisterWorker(workerId);
  },
};

