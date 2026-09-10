import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { mockDb, mockWorkspace } from '@/lib/mock/store';
import { generateId } from '@/lib/ids/generator';
import { UsageMetric } from '@/types/database';

export interface AnalyticsSummary {
  workspaceId: string;
  period: string;
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number; // percentage e.g. 78.5%
  totalBytesTransferred: number;
  totalBytesSaved: number;
  bandwidthSavedPercent: number; // percentage e.g. 64.2%
  avgLatencyMs: number;
  formatBreakdown: {
    format: string;
    count: number;
    bytes: number;
  }[];
  topAssets: {
    assetId: string;
    displayName: string;
    mimeType: string;
    requestsCount: number;
    bytesTransferred: number;
    storageUrl?: string | null;
  }[];
  recentEvents: {
    id: string;
    assetId?: string | null;
    eventType: string;
    bytesTransferred: number;
    bytesSaved: number;
    format?: string | null;
    latencyMs: number;
    createdAt: string;
  }[];
}

export const analyticsService = {
  /**
   * Record a media metric event asynchronously
   */
  async recordMetric(data: {
    workspaceId: string;
    assetId?: string | null;
    eventType: 'delivery' | 'cache_hit' | 'upload' | 'replace' | 'delete';
    bytesTransferred?: number;
    bytesSaved?: number;
    format?: string | null;
    latencyMs?: number;
    userAgent?: string | null;
  }): Promise<void> {
    const metric: UsageMetric = {
      id: generateId('met'),
      workspace_id: data.workspaceId || mockWorkspace.id,
      asset_id: data.assetId || null,
      event_type: data.eventType,
      bytes_transferred: Math.max(0, data.bytesTransferred || 0),
      bytes_saved: Math.max(0, data.bytesSaved || 0),
      format: data.format || 'unknown',
      latency_ms: Math.max(0, data.latencyMs || 0),
      user_agent: data.userAgent || null,
      created_at: new Date().toISOString(),
    };

    if (!isSupabaseAdminConfigured()) {
      mockDb.usageMetrics.unshift(metric);
      if (mockDb.usageMetrics.length > 1000) {
        mockDb.usageMetrics.pop();
      }
      return;
    }

    try {
      await supabaseAdmin.from('usage_metrics').insert(metric);
    } catch (err: any) {
      console.warn('[AnalyticsService] Failed to record metric:', err?.message);
    }
  },

  /**
   * Aggregate metrics for workspace
   */
  async getWorkspaceAnalytics(
    workspaceId: string = mockWorkspace.id,
    period: '24h' | '7d' | '30d' = '24h'
  ): Promise<AnalyticsSummary> {
    const now = new Date();
    let sinceTime: Date;
    switch (period) {
      case '7d':
        sinceTime = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
        break;
      case '30d':
        sinceTime = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
        break;
      case '24h':
      default:
        sinceTime = new Date(now.getTime() - 24 * 3600 * 1000);
        break;
    }

    let metrics: UsageMetric[] = [];

    if (!isSupabaseAdminConfigured()) {
      metrics = mockDb.usageMetrics.filter(
        (m) =>
          m.workspace_id === workspaceId &&
          new Date(m.created_at).getTime() >= sinceTime.getTime()
      );
    } else {
      const { data, error } = await supabaseAdmin
        .from('usage_metrics')
        .select('*')
        .eq('workspace_id', workspaceId)
        .gte('created_at', sinceTime.toISOString())
        .order('created_at', { ascending: false })
        .limit(2000);

      if (!error && data) {
        metrics = data as UsageMetric[];
      }
    }

    // Production Invariant: Empty metrics return real zero telemetry without injecting fake data

    const totalRequests = metrics.length;
    const cacheHits = metrics.filter((m) => m.event_type === 'cache_hit').length;
    const cacheMisses = totalRequests - cacheHits;
    const cacheHitRate = totalRequests > 0 ? Math.round((cacheHits / totalRequests) * 1000) / 10 : 0;

    let totalBytesTransferred = 0;
    let totalBytesSaved = 0;
    let totalLatency = 0;

    const formatMap = new Map<string, { count: number; bytes: number }>();
    const assetRequestMap = new Map<string, { count: number; bytes: number }>();

    for (const m of metrics) {
      totalBytesTransferred += Number(m.bytes_transferred || 0);
      totalBytesSaved += Number(m.bytes_saved || 0);
      totalLatency += Number(m.latency_ms || 0);

      const fmt = (m.format || 'unknown').toLowerCase();
      const curFmt = formatMap.get(fmt) || { count: 0, bytes: 0 };
      curFmt.count += 1;
      curFmt.bytes += Number(m.bytes_transferred || 0);
      formatMap.set(fmt, curFmt);

      if (m.asset_id) {
        const curAsset = assetRequestMap.get(m.asset_id) || { count: 0, bytes: 0 };
        curAsset.count += 1;
        curAsset.bytes += Number(m.bytes_transferred || 0);
        assetRequestMap.set(m.asset_id, curAsset);
      }
    }

    const totalCalculatedBytes = totalBytesTransferred + totalBytesSaved;
    const bandwidthSavedPercent =
      totalCalculatedBytes > 0
        ? Math.round((totalBytesSaved / totalCalculatedBytes) * 1000) / 10
        : 0;

    const avgLatencyMs = totalRequests > 0 ? Math.round(totalLatency / totalRequests) : 0;

    const formatBreakdown = Array.from(formatMap.entries()).map(([format, data]) => ({
      format,
      count: data.count,
      bytes: data.bytes,
    }));

    const sortedAssets = Array.from(assetRequestMap.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10);

    const topAssets = sortedAssets.map(([assetId, data]) => {
      const foundMock = mockDb.assets.find((a) => a.id === assetId);
      return {
        assetId,
        displayName: foundMock?.display_name || assetId,
        mimeType: foundMock?.mime_type || 'image/jpeg',
        requestsCount: data.count,
        bytesTransferred: data.bytes,
        storageUrl: foundMock?.storage_url || null,
      };
    });

    const recentEvents = metrics.slice(0, 20).map((m) => ({
      id: m.id,
      assetId: m.asset_id,
      eventType: m.event_type,
      bytesTransferred: Number(m.bytes_transferred),
      bytesSaved: Number(m.bytes_saved),
      format: m.format,
      latencyMs: m.latency_ms,
      createdAt: m.created_at,
    }));

    return {
      workspaceId,
      period,
      totalRequests,
      cacheHits,
      cacheMisses,
      cacheHitRate,
      totalBytesTransferred,
      totalBytesSaved,
      bandwidthSavedPercent,
      avgLatencyMs,
      formatBreakdown,
      topAssets,
      recentEvents,
    };
  },
};
