import { getStorageProvider } from '@/lib/storage/factory';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { mockDb } from '@/lib/mock/store';
import { AppError } from '@/lib/errors/app-error';

export interface PurgeResult {
  assetId: string;
  storageKeysDeleted: string[];
  recordsPurged: {
    variants: number;
    versions: number;
    references: number;
    jobs: number;
  };
  success: boolean;
}

export const purgeService = {
  /**
   * Execute full artifact graph purge for an asset
   * Deletes original, all variants, all versions, transform caches, HLS ladder, document previews, and DB records.
   * Guaranteed idempotent.
   */
  async purgeAssetArtifactGraph(assetId: string, workspaceId: string): Promise<PurgeResult> {
    const storage = getStorageProvider();
    const deletedKeys: string[] = [];

    // 1. Fetch Asset
    let asset: any = null;
    if (isSupabaseAdminConfigured()) {
      const { data } = await supabaseAdmin
        .from('assets')
        .select('*')
        .eq('id', assetId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();
      asset = data;
    } else {
      asset = mockDb.assets.find((a) => a.id === assetId && a.workspace_id === workspaceId);
    }

    if (!asset) {
      // Idempotent: if already deleted from DB, consider successfully cleaned
      return {
        assetId,
        storageKeysDeleted: [],
        recordsPurged: { variants: 0, versions: 0, references: 0, jobs: 0 },
        success: true,
      };
    }

    // 2. Collect all storage keys to delete
    const keysToDelete = new Set<string>();

    // Original file
    if (asset.storage_key) {
      keysToDelete.add(asset.storage_key);
    }

    // Variants from DB
    if (isSupabaseAdminConfigured()) {
      const { data: variants } = await supabaseAdmin
        .from('asset_variants')
        .select('storage_key')
        .eq('asset_id', assetId);

      for (const v of variants || []) {
        if (v.storage_key) keysToDelete.add(v.storage_key);
      }

      const { data: versions } = await supabaseAdmin
        .from('asset_versions')
        .select('storage_key')
        .eq('asset_id', assetId);

      for (const ver of versions || []) {
        if (ver.storage_key) keysToDelete.add(ver.storage_key);
      }
    } else {
      const mockVars = mockDb.assetVariants.filter((v) => v.asset_id === assetId);
      for (const v of mockVars) {
        if (v.storage_key) keysToDelete.add(v.storage_key);
      }
    }

    // Common directory prefixes to clean up
    // images/{asset_id}/, videos/{asset_id}/, documents/{asset_id}/, transforms/{asset_id}/
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'media-assets';

    if (isSupabaseAdminConfigured()) {
      try {
        for (const prefix of [`images/${assetId}`, `videos/${assetId}`, `documents/${assetId}`, `transforms/${assetId}`]) {
          const { data: fileList } = await supabaseAdmin.storage.from(bucket).list(prefix, { limit: 100 });
          for (const item of fileList || []) {
            if (item.name) {
              keysToDelete.add(`${prefix}/${item.name}`);
            }
          }
        }
      } catch {
        // Continue
      }
    }

    // 3. Delete physical storage objects
    for (const key of keysToDelete) {
      try {
        await storage.delete(key, bucket);
        deletedKeys.push(key);
      } catch {
        // Safe against non-existent files
      }
    }

    // 4. Delete DB records
    let variantsCount = 0;
    let versionsCount = 0;
    let referencesCount = 0;
    let jobsCount = 0;

    if (isSupabaseAdminConfigured()) {
      const { count: varC } = await supabaseAdmin.from('asset_variants').delete({ count: 'exact' }).eq('asset_id', assetId);
      const { count: verC } = await supabaseAdmin.from('asset_versions').delete({ count: 'exact' }).eq('asset_id', assetId);
      const { count: refC } = await supabaseAdmin.from('asset_references').delete({ count: 'exact' }).eq('asset_id', assetId);
      const { count: jobC } = await supabaseAdmin.from('processing_jobs').delete({ count: 'exact' }).eq('asset_id', assetId);
      await supabaseAdmin.from('integrity_issues').delete().eq('asset_id', assetId);
      await supabaseAdmin.from('assets').delete().eq('id', assetId);

      variantsCount = varC || 0;
      versionsCount = verC || 0;
      referencesCount = refC || 0;
      jobsCount = jobC || 0;
    } else {
      mockDb.assetVariants = mockDb.assetVariants.filter((v) => v.asset_id !== assetId);
      mockDb.assetVersions = mockDb.assetVersions.filter((v) => v.asset_id !== assetId);
      mockDb.references = mockDb.references.filter((r) => r.asset_id !== assetId);
      mockDb.processingJobs = mockDb.processingJobs.filter((j) => j.asset_id !== assetId);
      mockDb.assets = mockDb.assets.filter((a) => a.id !== assetId);
    }

    return {
      assetId,
      storageKeysDeleted: deletedKeys,
      recordsPurged: {
        variants: variantsCount,
        versions: versionsCount,
        references: referencesCount,
        jobs: jobsCount,
      },
      success: true,
    };
  },
};
