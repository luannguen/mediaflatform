import { AuditEvent } from '@/types/database';
import { generateId } from '@/lib/ids/generator';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { mockWorkspace } from '@/lib/mock/store';

export interface RecordAuditInput {
  workspaceId?: string;
  actorType: 'user' | 'service_account' | 'system';
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  changesSummary?: Record<string, any>;
  requestId?: string | null;
}

// In-memory fallback
const inMemoryAuditLogs: AuditEvent[] = [];

export const auditService = {
  async record(input: RecordAuditInput): Promise<AuditEvent> {
    const id = generateId('evt');
    const workspaceId = input.workspaceId || mockWorkspace.id;
    const now = new Date().toISOString();

    const event: AuditEvent = {
      id,
      workspace_id: workspaceId,
      actor_type: input.actorType,
      actor_id: input.actorId,
      action: input.action,
      resource_type: input.resourceType,
      resource_id: input.resourceId,
      changes_summary: input.changesSummary || {},
      request_id: input.requestId || null,
      created_at: now,
    };

    if (!isSupabaseAdminConfigured()) {
      inMemoryAuditLogs.unshift(event);
      return event;
    }

    // Asynchronous persist to Supabase without blocking caller
    supabaseAdmin
      .from('audit_events')
      .insert(event)
      .then(({ error }) => {
        if (error) console.error('[AuditService] Failed to record audit event:', error.message);
      });

    return event;
  },

  async list(workspaceId: string = mockWorkspace.id, limit: number = 50): Promise<AuditEvent[]> {
    if (!isSupabaseAdminConfigured()) {
      return inMemoryAuditLogs.filter((e) => e.workspace_id === workspaceId).slice(0, limit);
    }

    const { data, error } = await supabaseAdmin
      .from('audit_events')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[AuditService] Failed to list audit events:', error.message);
      return [];
    }

    return (data as AuditEvent[]) || [];
  },
};
