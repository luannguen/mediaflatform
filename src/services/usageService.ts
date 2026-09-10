import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { mockWorkspace, mockDb } from '@/lib/mock/store';

export interface WorkspaceUsageSummary {
  workspaceId: string;
  storage: {
    usedBytes: number;
    limitBytes: number;
    usagePercent: number;
  };
  assets: {
    totalCount: number;
    limitCount: number;
    usagePercent: number;
    breakdown: {
      images: number;
      videos: number;
      documents: number;
      archives: number;
      other: number;
    };
  };
  metrics: {
    apiRequests: number;
    deliveryBytes: number;
    imageTransforms: number;
    videoTranscodes: number;
    documentJobs: number;
    webhookDeliveries: number;
  };
}

export const usageService = {
  async getWorkspaceUsage(workspaceId: string = mockWorkspace.id): Promise<WorkspaceUsageSummary> {
    let usedBytes = 0;
    let totalAssets = 0;
    let limitStorageBytes = 10 * 1024 * 1024 * 1024; // 10 GB default
    let limitAssetCount = 10000;
    const breakdown = { images: 0, videos: 0, documents: 0, archives: 0, other: 0 };
    let apiRequests = 0;
    let deliveryBytes = 0;
    let imageTransforms = 0;
    let videoTranscodes = 0;
    let documentJobs = 0;
    let webhookDeliveries = 0;

    if (!isSupabaseAdminConfigured()) {
      const wsAssets = mockDb.assets.filter((a) => a.workspace_id === workspaceId && a.status !== 'deleted');
      totalAssets = wsAssets.length;
      for (const a of wsAssets) {
        usedBytes += a.size_bytes || 0;
        if (a.asset_type === 'image') breakdown.images += 1;
        else if (a.asset_type === 'video') breakdown.videos += 1;
        else if (a.asset_type === 'document') breakdown.documents += 1;
        else if (a.asset_type === 'archive') breakdown.archives += 1;
        else breakdown.other += 1;
      }
      apiRequests = mockDb.usageMetrics.length;
      webhookDeliveries = mockDb.webhookDeliveries.length;
    } else {
      // Query workspace quota
      const { data: ws } = await supabaseAdmin
        .from('workspaces')
        .select('quota_storage_bytes, quota_asset_count')
        .eq('id', workspaceId)
        .maybeSingle();

      if (ws) {
        limitStorageBytes = ws.quota_storage_bytes || limitStorageBytes;
        limitAssetCount = ws.quota_asset_count || limitAssetCount;
      }

      // Query real assets in workspace
      const { data: assets } = await supabaseAdmin
        .from('assets')
        .select('asset_type, size_bytes')
        .eq('workspace_id', workspaceId)
        .neq('status', 'deleted');

      if (assets) {
        totalAssets = assets.length;
        for (const a of assets) {
          usedBytes += Number(a.size_bytes || 0);
          if (a.asset_type === 'image') breakdown.images += 1;
          else if (a.asset_type === 'video') breakdown.videos += 1;
          else if (a.asset_type === 'document') breakdown.documents += 1;
          else if (a.asset_type === 'archive') breakdown.archives += 1;
          else breakdown.other += 1;
        }
      }

      // Query jobs in workspace
      const { data: jobs } = await supabaseAdmin
        .from('processing_jobs')
        .select('job_type')
        .eq('workspace_id', workspaceId);

      if (jobs) {
        for (const j of jobs) {
          if (j.job_type === 'image_optimization') imageTransforms += 1;
          else if (j.job_type === 'transcode_video' || j.job_type === 'video_transcode') videoTranscodes += 1;
          else if (j.job_type === 'document_extract') documentJobs += 1;
        }
      }

      // Query API request logs
      const { count: reqCount } = await supabaseAdmin
        .from('api_request_logs')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId);
      apiRequests = reqCount || 0;

      // Query usage metrics
      const { data: metrics } = await supabaseAdmin
        .from('usage_metrics')
        .select('bytes_transferred')
        .eq('workspace_id', workspaceId);

      if (metrics) {
        for (const m of metrics) {
          deliveryBytes += Number(m.bytes_transferred || 0);
        }
      }

      // Query webhook deliveries
      const { count: whCount } = await supabaseAdmin
        .from('webhook_deliveries')
        .select('*', { count: 'exact', head: true });
      webhookDeliveries = whCount || 0;
    }

    const storageUsagePercent =
      limitStorageBytes > 0 ? Math.round((usedBytes / limitStorageBytes) * 1000) / 10 : 0;
    const assetUsagePercent =
      limitAssetCount > 0 ? Math.round((totalAssets / limitAssetCount) * 1000) / 10 : 0;

    return {
      workspaceId,
      storage: {
        usedBytes,
        limitBytes: limitStorageBytes,
        usagePercent: storageUsagePercent,
      },
      assets: {
        totalCount: totalAssets,
        limitCount: limitAssetCount,
        usagePercent: assetUsagePercent,
        breakdown,
      },
      metrics: {
        apiRequests,
        deliveryBytes,
        imageTransforms,
        videoTranscodes,
        documentJobs,
        webhookDeliveries,
      },
    };
  },
};
