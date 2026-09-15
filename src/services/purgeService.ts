import { getStorageProvider } from '@/lib/storage/factory';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { AppError } from '@/lib/errors/app-error';

export interface PurgeResult { assetId: string; storageKeysDeleted: string[]; recordsPurged: { variants: number; versions: number; references: number; jobs: number }; success: boolean; }
export async function listStorageTree(bucket: string, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  for (let offset=0;;offset+=1000) {
    const { data, error } = await supabaseAdmin.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error || !data) throw AppError.serviceUnavailable('Storage inventory failed; purge remains pending');
    for (const item of data) {
      const key = prefix + '/' + item.name;
      if (item.id) keys.push(key); else keys.push(...await listStorageTree(bucket,key));
    }
    if (data.length<1000) break;
  }
  return keys;
}
export const purgeService = {
  async purgeAssetArtifactGraph(assetId: string, workspaceId: string, force = false): Promise<PurgeResult> {
    const { data: prepared, error } = await supabaseAdmin.rpc('prepare_asset_purge',{p_asset_id:assetId,p_workspace_id:workspaceId,p_force:force});
    if (error) {
      if (error.message.includes('ASSET_IN_USE')) throw AppError.conflict('Asset has active references');
      throw AppError.serviceUnavailable('Could not prepare asset purge');
    }
    if (prepared?.absent) return {assetId,storageKeysDeleted:[],recordsPurged:{variants:0,versions:0,references:0,jobs:0},success:true};
    if (!prepared?.ready) throw AppError.conflict('Purge is pending while active workers stop. Retry after five minutes.');
    const asset=prepared.asset;
    const bucket=asset.storage_bucket || process.env.SUPABASE_STORAGE_BUCKET || 'media-assets';
    const keys=new Set<string>([asset.storage_key]);
    for (const table of ['asset_variants','asset_versions']) {
      for (let offset = 0;; offset += 1000) {
        const {data,error} = await supabaseAdmin.from(table).select('storage_key').eq('asset_id',assetId).order('id').range(offset, offset + 999);
        if (error || !data) throw AppError.serviceUnavailable('Artifact inventory failed');
        for (const row of data) if(row.storage_key) keys.add(row.storage_key);
        if (data.length < 1000) break;
      }
    }
    for(const prefix of ['images','videos','documents','transforms']) for(const key of await listStorageTree(bucket,prefix+'/'+assetId)) keys.add(key);
    const storage=getStorageProvider(); const deleted: string[]=[];
    for(const key of keys) { if(!await storage.delete(key,bucket)) throw AppError.serviceUnavailable('Object deletion failed; purge remains pending'); deleted.push(key); }
    const {data:counts,error:finishError}=await supabaseAdmin.rpc('finish_asset_purge',{p_asset_id:assetId,p_workspace_id:workspaceId});
    if(finishError) throw AppError.serviceUnavailable('Purge records remain pending; retry safely');
    return {assetId,storageKeysDeleted:deleted,recordsPurged:counts,success:true};
  },
};
