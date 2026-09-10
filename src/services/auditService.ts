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
    const workspaceId = input.workspaceId || (input as any).workspace_id || mockWorkspace.id;
    const actorType = input.actorType || (input as any).actor_type || 'system';
    const actorId = input.actorId || (input as any).actor_id || 'system';
    const resourceType = input.resourceType || (input as any).resource_type || 'unknown';
    const resourceId = input.resourceId || (input as any).resource_id || 'unknown';
    const changesSummary = input.changesSummary || (input as any).changes_summary || (input as any).metadata || {};
    const requestId = input.requestId || (input as any).request_id || null;
    const now = new Date().toISOString();

    const event: AuditEvent & { success?: boolean } = {
      id,
      workspace_id: workspaceId,
      actor_type: actorType,
      actor_id: actorId,
      action: input.action,
      resource_type: resourceType,
      resource_id: resourceId,
      changes_summary: changesSummary,
      request_id: requestId,
      created_at: now,
    };

    if (!isSupabaseAdminConfigured()) {
      inMemoryAuditLogs.unshift(event);
      event.success = true;
      return event;
    }

    // Asynchronous persist to Supabase without blocking caller
    supabaseAdmin
      .from('audit_events')
      .insert(event)
      .then(({ error }) => {
        if (error) console.error('[AuditService] Failed to record audit event:', error.message);
      });

    event.success = true;
    return event;
  },

  /**
   * Durable audit logging for security-sensitive events (API keys, permissions, purges)
   * Waits for database persistence to guarantee audit trail durability.
   */
  async recordCritical(input: RecordAuditInput | any): Promise<AuditEvent & { success: boolean }> {
    const id = generateId('evt');
    const workspaceId = input.workspaceId || (input as any).workspace_id || mockWorkspace.id;
    const actorType = input.actorType || (input as any).actor_type || 'system';
    const actorId = input.actorId || (input as any).actor_id || 'system';
    const resourceType = input.resourceType || (input as any).resource_type || 'unknown';
    const resourceId = input.resourceId || (input as any).resource_id || 'unknown';
    const changesSummary = input.changesSummary || (input as any).changes_summary || (input as any).metadata || {};
    const requestId = input.requestId || (input as any).request_id || null;
    const now = new Date().toISOString();

    const event: AuditEvent & { success: boolean } = {
      id,
      workspace_id: workspaceId,
      actor_type: actorType,
      actor_id: actorId,
      action: input.action,
      resource_type: resourceType,
      resource_id: resourceId,
      changes_summary: changesSummary,
      request_id: requestId,
      created_at: now,
      success: true,
    };

    if (!isSupabaseAdminConfigured()) {
      inMemoryAuditLogs.unshift(event);
      return event;
    }

    const { error } = await supabaseAdmin.from('audit_events').insert({
      id: event.id,
      workspace_id: event.workspace_id,
      actor_type: event.actor_type,
      actor_id: event.actor_id,
      action: event.action,
      resource_type: event.resource_type,
      resource_id: event.resource_id,
      changes_summary: event.changes_summary,
      request_id: event.request_id,
      created_at: event.created_at,
    });

    if (error) {
      console.error('[AuditService] Critical audit write failed:', error.message);
      event.success = false;
    }
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

  /**
   * Query audit event timeline for a specific resource (e.g. med_xxx)
   */
  async listByResource(
    resourceType: string,
    resourceId: string,
    workspaceId: string = mockWorkspace.id,
    limit: number = 50
  ): Promise<AuditEvent[]> {
    if (!isSupabaseAdminConfigured()) {
      return inMemoryAuditLogs
        .filter(
          (e) =>
            e.workspace_id === workspaceId &&
            e.resource_type === resourceType &&
            e.resource_id === resourceId
        )
        .slice(0, limit);
    }

    const { data, error } = await supabaseAdmin
      .from('audit_events')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('resource_type', resourceType)
      .eq('resource_id', resourceId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[AuditService] Failed to query resource audit timeline:', error.message);
      return [];
    }

    return (data as AuditEvent[]) || [];
  },
};
