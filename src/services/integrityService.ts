import { getStorageProvider } from '@/lib/storage/factory';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { mockDb } from '@/lib/mock/store';
import { IntegrityIssue, IntegrityIssueType, IntegrityIssueSeverity } from '@/types/database';
import { generateId } from '@/lib/ids/generator';

export const integrityService = {
  /**
   * Scan storage and database for corruption, missing files, or broken references
   */
  async scanWorkspaceIntegrity(workspaceId: string): Promise<IntegrityIssue[]> {
    const issues: IntegrityIssue[] = [];
    const storage = getStorageProvider();
    const now = new Date().toISOString();

    if (!isSupabaseAdminConfigured()) return [];

    // 1. Fetch active assets
    const { data: assets } = await supabaseAdmin
      .from('assets')
      .select('*')
      .eq('workspace_id', workspaceId)
      .neq('status', 'deleted');

    for (const asset of assets || []) {
      // Check original file existence
      if (asset.storage_key) {
        const exists = await storage.exists(asset.storage_key);
        if (!exists) {
          issues.push({
            id: generateId('iss'),
            workspace_id: workspaceId,
            asset_id: asset.id,
            issue_type: 'MISSING_ORIGINAL',
            severity: 'critical',
            storage_key: asset.storage_key,
            details: { message: `Original storage object not found: ${asset.storage_key}` },
            status: 'detected',
            detected_at: now,
            created_at: now,
          });
        }
      }

      // Check video master playlist
      if (asset.asset_type === 'video' && asset.processing_status === 'ready') {
        const version = asset.metadata_json?.active_output_version || 'v1';
        const masterKey = `videos/${asset.id}/${version}/master.m3u8`;
        const exists = await storage.exists(masterKey);
        if (!exists) {
          issues.push({
            id: generateId('iss'),
            workspace_id: workspaceId,
            asset_id: asset.id,
            issue_type: 'MISSING_VIDEO_MANIFEST',
            severity: 'high',
            storage_key: masterKey,
            details: { message: 'Master HLS manifest missing for ready video' },
            status: 'detected',
            detected_at: now,
            created_at: now,
          });
        }
      }

      // Check image variants
      if (asset.asset_type === 'image' && asset.processing_status === 'ready') {
        const { data: variants } = await supabaseAdmin
          .from('asset_variants')
          .select('*')
          .eq('asset_id', asset.id);

        for (const v of variants || []) {
          if (v.storage_key) {
            const exists = await storage.exists(v.storage_key);
            if (!exists) {
              issues.push({
                id: generateId('iss'),
                workspace_id: workspaceId,
                asset_id: asset.id,
                issue_type: 'MISSING_VARIANT',
                severity: 'medium',
                storage_key: v.storage_key,
                details: { variant_name: v.variant_name },
                status: 'detected',
                detected_at: now,
                created_at: now,
              });
            }
          }
        }
      }
    }

    // Persist issues
    if (issues.length > 0) {
      await supabaseAdmin.from('integrity_issues').insert(issues);
    }

    return issues;
  },

  /**
   * Cleanup abandoned uploads older than TTL minutes
   */
  async cleanupAbandonedUploads(workspaceId: string, ttlMinutes: number = 120): Promise<{ cleanedCount: number }> {
    const cutoff = new Date(Date.now() - ttlMinutes * 60 * 1000).toISOString();
    let count = 0;

    if (!isSupabaseAdminConfigured()) return { cleanedCount: 0 };

    const { data: abandoned } = await supabaseAdmin
      .from('assets')
      .select('id, storage_key')
      .eq('workspace_id', workspaceId)
      .eq('status', 'uploading')
      .lt('created_at', cutoff);

    const storage = getStorageProvider();
    for (const item of abandoned || []) {
      if (item.storage_key) {
        try {
          await storage.delete(item.storage_key);
        } catch {}
      }
      await supabaseAdmin.from('assets').delete().eq('id', item.id);
      count++;
    }

    return { cleanedCount: count };
  },
};
