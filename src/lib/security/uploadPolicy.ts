import { AppError } from '@/lib/errors/app-error';
import { AssetType } from '@/types/database';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';

export const TYPE_MAX_BYTES: Record<AssetType, number> = {
  image: 25 * 1024 * 1024,      // 25MB
  video: 500 * 1024 * 1024,     // 500MB
  document: 50 * 1024 * 1024,   // 50MB
  audio: 50 * 1024 * 1024,      // 50MB
  archive: 50 * 1024 * 1024,    // 50MB
  other: 25 * 1024 * 1024,      // 25MB
};

export function validateUploadLimits(assetType: AssetType, sizeBytes: number): void {
  const maxAllowed = TYPE_MAX_BYTES[assetType] || TYPE_MAX_BYTES.other;
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > maxAllowed) {
    const maxMb = Math.round(maxAllowed / (1024 * 1024));
    throw AppError.badRequest(
      `File size (${(sizeBytes / (1024 * 1024)).toFixed(1)}MB) exceeds maximum limit of ${maxMb}MB for type ${assetType}`,
      'UPLOAD_TOO_LARGE'
    );
  }
}

export async function checkWorkspaceQuota(workspaceId: string, incomingBytes: number): Promise<void> {
  if (!isSupabaseAdminConfigured()) return;

  try {
    const { data: ws, error } = await supabaseAdmin
      .from('workspaces')
      .select('quota_storage_bytes, quota_asset_count')
      .eq('id', workspaceId)
      .maybeSingle();

    if (error || !ws) return;

    if (ws.quota_storage_bytes) {
      const { data: usage } = await supabaseAdmin
        .from('assets')
        .select('size_bytes')
        .eq('workspace_id', workspaceId)
        .neq('status', 'deleted');

      const currentBytes = (usage || []).reduce((acc: number, row: any) => acc + (Number(row.size_bytes) || 0), 0);
      if (currentBytes + incomingBytes > ws.quota_storage_bytes) {
        throw AppError.badRequest('Workspace storage quota exceeded', 'QUOTA_EXCEEDED');
      }
    }
  } catch (err: any) {
    if (err?.code === 'QUOTA_EXCEEDED') throw err;
  }
}
