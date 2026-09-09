import { WebhookEndpoint, WebhookDelivery } from '@/types/database';
import { generateId } from '@/lib/ids/generator';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { mockWorkspace, mockDb } from '@/lib/mock/store';
import { AppError } from '@/lib/errors/app-error';
import crypto from 'crypto';

export interface CreateWebhookInput {
  workspaceId?: string;
  applicationId?: string;
  name: string;
  url: string;
  events: string[];
}

export const webhookService = {
  async listEndpoints(workspaceId: string = mockWorkspace.id): Promise<WebhookEndpoint[]> {
    if (!isSupabaseAdminConfigured()) {
      return mockDb.webhookEndpoints.filter((w) => w.workspace_id === workspaceId);
    }
    const { data, error } = await supabaseAdmin.from('webhook_endpoints').select('*').eq('workspace_id', workspaceId);
    if (error) throw AppError.internal(`Failed to list webhooks: ${error.message}`);
    return (data as WebhookEndpoint[]) || [];
  },

  async createEndpoint(input: CreateWebhookInput): Promise<{ endpoint: WebhookEndpoint; secret: string }> {
    const id = generateId('wh');
    const workspaceId = input.workspaceId || mockWorkspace.id;
    const now = new Date().toISOString();
    const rawSecret = `whsec_${crypto.randomBytes(24).toString('hex')}`;

    const endpoint: WebhookEndpoint = {
      id,
      workspace_id: workspaceId,
      application_id: input.applicationId || null,
      name: input.name,
      url: input.url,
      events: input.events,
      secret_hash: rawSecret, // Stores the signing secret for outbound HMAC signatures
      status: 'active',
      created_at: now,
      updated_at: now,
    };

    if (!isSupabaseAdminConfigured()) {
      mockDb.webhookEndpoints.push(endpoint);
      return { endpoint, secret: rawSecret };
    }

    const { data, error } = await supabaseAdmin.from('webhook_endpoints').insert(endpoint).select().single();
    if (error) throw AppError.internal(`Failed to create webhook endpoint: ${error.message}`);

    return { endpoint: data as WebhookEndpoint, secret: rawSecret };
  },

  /**
   * Dispatch an event to all active matching webhook endpoints with optional deterministic Event ID
   */
  async dispatchEvent(
    workspaceId: string,
    eventType: string,
    dataPayload: any,
    options?: { eventId?: string }
  ) {
    const endpoints = await this.listEndpoints(workspaceId);
    const matching = endpoints.filter(
      (e) => e.status === 'active' && (e.events.includes('*') || e.events.includes(eventType))
    );

    // Prefer deterministic event ID for idempotent consumer deduplication
    const eventId = options?.eventId || dataPayload?.event_id || `evt_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    const payload = {
      event_id: eventId,
      event_type: eventType,
      created_at: new Date().toISOString(),
      data: { ...dataPayload, event_id: eventId },
    };

    // Asynchronously dispatch without blocking caller
    for (const ep of matching) {
      this.deliver(ep, eventType, eventId, payload).catch((err) =>
        console.warn(`[Webhook] Delivery failed to ${ep.url}:`, err.message)
      );
    }
  },

  async deliver(ep: WebhookEndpoint, eventType: string, eventId: string, payload: any) {
    const payloadString = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', ep.secret_hash).update(payloadString).digest('hex');

    let httpStatus = 0;
    let status: 'delivered' | 'failed' = 'failed';
    let responseSummary = '';

    try {
      const res = await fetch(ep.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Media-Event': eventType,
          'X-Media-Delivery': eventId,
          'X-Media-Signature': signature,
        },
        body: payloadString,
        signal: AbortSignal.timeout(5000), // 5 seconds timeout
      });

      httpStatus = res.status;
      status = res.ok ? 'delivered' : 'failed';
      responseSummary = `HTTP ${res.status}`;
    } catch (err: any) {
      responseSummary = err.message || 'Connection failed';
    }

    const deliveryRecord: WebhookDelivery = {
      id: generateId('evt'),
      webhook_endpoint_id: ep.id,
      event_type: eventType,
      event_id: eventId,
      payload,
      status,
      http_status: httpStatus || undefined,
      attempt_count: 1,
      last_attempt_at: new Date().toISOString(),
      response_summary: responseSummary,
      created_at: new Date().toISOString(),
    };

    if (isSupabaseAdminConfigured()) {
      supabaseAdmin.from('webhook_deliveries').insert(deliveryRecord).then();
    } else {
      mockDb.webhookDeliveries.push(deliveryRecord);
    }
  },

  async listDeliveries(endpointId?: string): Promise<WebhookDelivery[]> {
    if (!isSupabaseAdminConfigured()) {
      if (endpointId) {
        return mockDb.webhookDeliveries.filter((d) => d.webhook_endpoint_id === endpointId);
      }
      return mockDb.webhookDeliveries;
    }
    let query = supabaseAdmin.from('webhook_deliveries').select('*').order('created_at', { ascending: false }).limit(50);
    if (endpointId) {
      query = query.eq('webhook_endpoint_id', endpointId);
    }
    const { data } = await query;
    return (data as WebhookDelivery[]) || [];
  },
};
