import { Asset, AssetType, AssetStatus, AssetVersion, ProcessingStatus } from '@/types/database';
import { AppError } from '@/lib/errors/app-error';
import { ErrorCodes } from '@/lib/errors/codes';
import { generateId } from '@/lib/ids/generator';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { mockDb, mockWorkspace } from '@/lib/mock/store';
import { getStorageProvider } from '@/lib/storage/factory';
import { webhookService } from '@/services/webhookService';

export interface ListAssetsParams {
  workspaceId?: string;
  folderId?: string | null;
  assetType?: AssetType | 'all';
  status?: AssetStatus | 'all';
  search?: string;
  page?: number;
  limit?: number | 'all';
  cursor?: string;
  unlimited?: boolean;
  fields?: string[];
  sort?: 'newest' | 'oldest' | 'name' | 'size';
}

export interface CreateAssetInput {
  workspaceId?: string;
  folderId?: string | null;
  assetType?: AssetType;
  originalFilename: string;
  displayName?: string;
  description?: string;
  mimeType: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  storageKey: string;
  storageUrl?: string;
  checksum?: string;
  visibility?: 'private' | 'workspace' | 'public';
  createdByUserId?: string;
  createdByServiceAccountId?: string;
  processingStatus?: ProcessingStatus;
  metadata?: Record<string, any>;
}

export const assetService = {
  async checkDuplicate(checksum: string, workspaceId: string = mockWorkspace.id): Promise<Asset | null> {
    if (!checksum) return null;
    if (!isSupabaseAdminConfigured()) {
      return mockDb.assets.find((a) => a.workspace_id === workspaceId && a.checksum === checksum && a.status === 'active') || null;
    }
    const { data } = await supabaseAdmin
      .from('assets')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('checksum', checksum)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    return (data as Asset) || null;
  },

  async listAssets(params: ListAssetsParams = {}) {
    const workspaceId = params.workspaceId || mockWorkspace.id;
    const isUnlimited = params.unlimited === true || params.limit === 'all';
    const limit = isUnlimited ? 1000 : Math.min(100, Math.max(1, typeof params.limit === 'number' ? params.limit : 24));
    let page = Math.max(1, params.page || 1);
    let offset = (page - 1) * limit;

    if (!isSupabaseAdminConfigured()) {
      let filtered = mockDb.assets.filter((a) => a.workspace_id === workspaceId);

      // Status filter
      if (params.status && params.status !== 'all') {
        filtered = filtered.filter((a) => a.status === params.status);
      } else {
        filtered = filtered.filter((a) => a.status !== 'trashed' && a.status !== 'deleted');
      }

      // Folder filter
      if (params.folderId !== undefined) {
        filtered = filtered.filter((a) => a.folder_id === params.folderId);
      }

      // Type filter
      if (params.assetType && params.assetType !== 'all') {
        filtered = filtered.filter((a) => a.asset_type === params.assetType);
      }

      // Search filter
      if (params.search) {
        const q = params.search.toLowerCase();
        filtered = filtered.filter(
          (a) =>
            a.display_name.toLowerCase().includes(q) ||
            a.original_filename.toLowerCase().includes(q) ||
            a.id.toLowerCase().includes(q)
        );
      }

      // Sorting
      filtered.sort((a, b) => {
        if (params.sort === 'oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        if (params.sort === 'name') return a.display_name.localeCompare(b.display_name);
        if (params.sort === 'size') return b.size_bytes - a.size_bytes;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });

      // Cursor-based pagination in mock mode
      if (params.cursor) {
        const cursorIdx = filtered.findIndex((a) => a.id === params.cursor);
        if (cursorIdx !== -1) {
          offset = cursorIdx + 1;
        }
      }

      const total = filtered.length;
      const paginated = filtered.slice(offset, offset + limit);
      const hasMore = offset + limit < total;
      const nextCursor = hasMore && paginated.length > 0 ? paginated[paginated.length - 1].id : null;

      // Project sparse fieldsets if specified
      let resultAssets: any[] = paginated;
      if (params.fields && params.fields.length > 0) {
        const set = new Set([...params.fields, 'id']);
        resultAssets = paginated.map((item) => {
          const projected: Record<string, any> = {};
          for (const key of set) {
            if (key in item) projected[key] = (item as any)[key];
          }
          return projected;
        });
      }

      return {
        assets: resultAssets,
        total,
        page: params.cursor ? undefined : page,
        limit,
        hasMore,
        nextCursor,
      };
    }

    // Supabase Real Queries
    let query = supabaseAdmin
      .from('assets')
      .select('*', { count: 'exact' })
      .eq('workspace_id', workspaceId);

    if (params.status && params.status !== 'all') {
      query = query.eq('status', params.status);
    } else {
      query = query.neq('status', 'trashed').neq('status', 'deleted');
    }

    if (params.folderId !== undefined) {
      if (params.folderId === null) {
        query = query.is('folder_id', null);
      } else {
        query = query.eq('folder_id', params.folderId);
      }
    }

    if (params.assetType && params.assetType !== 'all') {
      query = query.eq('asset_type', params.assetType);
    }

    if (params.search) {
      query = query.or(`display_name.ilike.%${params.search}%,original_filename.ilike.%${params.search}%,id.ilike.%${params.search}%`);
    }

    if (params.cursor) {
      const { data: cursorAsset } = await supabaseAdmin
        .from('assets')
        .select('id, created_at, display_name, size_bytes')
        .eq('id', params.cursor)
        .maybeSingle();

      if (cursorAsset) {
        query = query.neq('id', params.cursor);
        if (params.sort === 'oldest') {
          query = query.gt('created_at', cursorAsset.created_at);
        } else if (params.sort === 'name') {
          query = query.gt('display_name', cursorAsset.display_name);
        } else if (params.sort === 'size') {
          query = query.lt('size_bytes', cursorAsset.size_bytes);
        } else {
          query = query.lt('created_at', cursorAsset.created_at);
        }
        offset = 0;
      }
    }

    if (params.sort === 'oldest') {
      query = query.order('created_at', { ascending: true });
    } else if (params.sort === 'name') {
      query = query.order('display_name', { ascending: true });
    } else if (params.sort === 'size') {
      query = query.order('size_bytes', { ascending: false });
    } else {
      query = query.order('created_at', { ascending: false });
    }

    const fetchLimit = params.cursor ? limit + 1 : limit;
    const { data, count, error } = await query.range(offset, offset + fetchLimit - 1);

    if (error) {
      throw AppError.internal(`Failed to list assets: ${error.message}`);
    }

    const total = count || 0;
    const rawData = (data as Asset[]) || [];
    let assetsData: Asset[] = [];
    let hasMore = false;

    if (params.cursor) {
      hasMore = rawData.length > limit;
      assetsData = hasMore ? rawData.slice(0, limit) : rawData;
    } else {
      assetsData = rawData;
      hasMore = offset + limit < total;
    }

    const nextCursor = hasMore && assetsData.length > 0 ? assetsData[assetsData.length - 1].id : null;

    let resultAssets: any[] = assetsData;
    if (params.fields && params.fields.length > 0) {
      const set = new Set([...params.fields, 'id']);
      resultAssets = assetsData.map((item) => {
        const projected: Record<string, any> = {};
        for (const key of set) {
          if (key in item) projected[key] = (item as any)[key];
        }
        return projected;
      });
    }

    return {
      assets: resultAssets,
      total,
      page: params.cursor ? undefined : page,
      limit,
      hasMore,
      nextCursor,
    };
  },

  /**
   * Batch Resolve Assets: High-performance endpoint preventing N+1 queries
   */
  async getAssetsBatch(
    ids: string[],
    workspaceId: string = mockWorkspace.id,
    fields?: string[]
  ): Promise<any[]> {
    if (!ids || ids.length === 0) return [];
    const uniqueIds = Array.from(new Set(ids)).slice(0, 100); // capped at 100 per batch

    let foundAssets: Asset[] = [];
    if (!isSupabaseAdminConfigured()) {
      foundAssets = mockDb.assets.filter(
        (a) => a.workspace_id === workspaceId && uniqueIds.includes(a.id) && a.status !== 'deleted'
      );
    } else {
      const { data, error } = await supabaseAdmin
        .from('assets')
        .select('*')
        .eq('workspace_id', workspaceId)
        .in('id', uniqueIds)
        .neq('status', 'deleted');
      if (error) {
        throw AppError.internal(`Failed to batch fetch assets: ${error.message}`);
      }
      foundAssets = (data as Asset[]) || [];
    }

    // Maintain input order
    const ordered = uniqueIds
      .map((id) => foundAssets.find((a) => a.id === id))
      .filter(Boolean) as Asset[];

    if (!fields || fields.length === 0) return ordered;

    const set = new Set([...fields, 'id']);
    return ordered.map((item) => {
      const projected: Record<string, any> = {};
      for (const key of set) {
        if (key in item) projected[key] = (item as any)[key];
      }
      return projected;
    });
  },

  async getAssetById(id: string, workspaceId: string = mockWorkspace.id): Promise<Asset & { referencesCount: number }> {
    if (!isSupabaseAdminConfigured()) {
      const asset = mockDb.assets.find((a) => a.id === id && a.workspace_id === workspaceId);
      if (!asset) throw AppError.notFound(`Asset ${id} not found`);
      const refCount = mockDb.references.filter((r) => r.asset_id === id).length;
      return { ...asset, referencesCount: refCount };
    }

    const { data: asset, error } = await supabaseAdmin
      .from('assets')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .single();

    if (error || !asset) {
      throw AppError.notFound(`Asset ${id} not found`);
    }

    const { count: refCount } = await supabaseAdmin
      .from('asset_references')
      .select('*', { count: 'exact', head: true })
      .eq('asset_id', id);

    return { ...(asset as Asset), referencesCount: refCount || 0 };
  },

  async createAsset(input: CreateAssetInput): Promise<Asset> {
    const id = generateId('med');
    const workspaceId = input.workspaceId || mockWorkspace.id;
    const ext = input.originalFilename.split('.').pop()?.toLowerCase() || 'bin';
    
    // Auto detect type if not given
    let type: AssetType = input.assetType || 'other';
    if (input.mimeType.startsWith('image/')) type = 'image';
    else if (input.mimeType.startsWith('video/')) type = 'video';
    else if (input.mimeType.startsWith('audio/')) type = 'audio';
    else if (input.mimeType.includes('pdf') || input.mimeType.includes('document') || input.mimeType.includes('text')) type = 'document';

    const now = new Date().toISOString();
    const asset: Asset = {
      id,
      workspace_id: workspaceId,
      folder_id: input.folderId || null,
      asset_type: type,
      original_filename: input.originalFilename,
      display_name: input.displayName || input.originalFilename,
      description: input.description || null,
      mime_type: input.mimeType,
      extension: ext,
      size_bytes: input.sizeBytes,
      width: input.width || null,
      height: input.height || null,
      duration_ms: input.durationMs || null,
      storage_provider: 'supabase',
      storage_bucket: process.env.SUPABASE_STORAGE_BUCKET || 'media-assets',
      storage_key: input.storageKey,
      storage_url: input.storageUrl || null,
      checksum_algorithm: 'sha256',
      checksum: input.checksum || null,
      visibility: input.visibility || 'workspace',
      status: 'active',
      processing_status: input.processingStatus || (type === 'video' ? 'pending' : 'ready'),
      created_by_user_id: input.createdByUserId || null,
      created_by_service_account_id: input.createdByServiceAccountId || null,
      metadata_json: input.metadata || {},
      created_at: now,
      updated_at: now,
    };

    let resultAsset = asset;
    if (!isSupabaseAdminConfigured()) {
      mockDb.assets.unshift(asset);
    } else {
      const { data, error } = await supabaseAdmin.from('assets').insert(asset).select().single();
      if (error) {
        throw AppError.internal(`Failed to insert asset: ${error.message}`);
      }
      resultAsset = data as Asset;
    }

    // Trigger outbound webhook event
    webhookService
      .dispatchEvent(resultAsset.workspace_id, 'asset.created', {
        asset_id: resultAsset.id,
        original_filename: resultAsset.original_filename,
        display_name: resultAsset.display_name,
        mime_type: resultAsset.mime_type,
        size_bytes: resultAsset.size_bytes,
        storage_url: resultAsset.storage_url,
        created_at: resultAsset.created_at,
      })
      .catch((err) => console.warn('[Webhook] Dispatch error:', err.message));

    return resultAsset;
  },

  async updateAsset(id: string, workspaceId: string = mockWorkspace.id, patch: Partial<Asset>): Promise<Asset> {
    const now = new Date().toISOString();

    if (!isSupabaseAdminConfigured()) {
      const idx = mockDb.assets.findIndex((a) => a.id === id && a.workspace_id === workspaceId);
      if (idx === -1) throw AppError.notFound(`Asset ${id} not found`);
      mockDb.assets[idx] = { ...mockDb.assets[idx], ...patch, updated_at: now };
      return mockDb.assets[idx];
    }

    const { data, error } = await supabaseAdmin
      .from('assets')
      .update({ ...patch, updated_at: now })
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .select()
      .single();

    if (error || !data) {
      throw AppError.notFound(`Asset ${id} not found or update failed: ${error?.message}`);
    }

    return data as Asset;
  },

  async trashAsset(id: string, workspaceId: string = mockWorkspace.id): Promise<Asset> {
    const now = new Date();
    const purgeDate = new Date(now.getTime() + 30 * 86400000); // 30 days retention

    const res = await this.updateAsset(id, workspaceId, {
      status: 'trashed',
      deleted_at: now.toISOString(),
      purge_after: purgeDate.toISOString(),
    });

    webhookService
      .dispatchEvent(workspaceId, 'asset.trashed', {
        asset_id: id,
        trashed_at: now.toISOString(),
        purge_after: purgeDate.toISOString(),
      })
      .catch((err) => console.warn('[Webhook] Dispatch error:', err.message));

    return res;
  },

  async restoreAsset(id: string, workspaceId: string = mockWorkspace.id): Promise<Asset> {
    const res = await this.updateAsset(id, workspaceId, {
      status: 'active',
      deleted_at: null,
      purge_after: null,
    });

    webhookService
      .dispatchEvent(workspaceId, 'asset.restored', {
        asset_id: id,
        restored_at: new Date().toISOString(),
      })
      .catch((err) => console.warn('[Webhook] Dispatch error:', err.message));

    return res;
  },

  /**
   * Safe Delete:
   * 1. Checks if asset has active references.
   * 2. If references > 0 and force is false -> BLOCKS deletion with ASSET_IN_USE and details.
   * 3. If allowed, deletes physical file from storage provider and deletes record from DB.
   */
  async safeDeleteAsset(id: string, workspaceId: string = mockWorkspace.id, force: boolean = false) {
    if (!isSupabaseAdminConfigured()) {
      const asset = mockDb.assets.find((a) => a.id === id && a.workspace_id === workspaceId);
      if (!asset) throw AppError.notFound(`Asset ${id} not found`);

      const references = mockDb.references.filter((r) => r.asset_id === id);
      if (references.length > 0 && !force) {
        throw AppError.conflict(
          `Cannot delete asset ${id} because it is currently referenced by ${references.length} external entities. Remove these references first or specify force delete.`,
          ErrorCodes.ASSET_IN_USE,
          { references }
        );
      }

      // Safe to delete
      const storage = getStorageProvider();
      await storage.delete(asset.storage_key);

      mockDb.assets = mockDb.assets.filter((a) => a.id !== id);
      mockDb.references = mockDb.references.filter((r) => r.asset_id !== id);

      webhookService
        .dispatchEvent(workspaceId, 'asset.deleted', {
          asset_id: id,
          deleted_at: new Date().toISOString(),
        })
        .catch((err) => console.warn('[Webhook] Dispatch error:', err.message));

      return { success: true, id, message: 'Asset deleted successfully' };
    }

    // Real Supabase flow
    const { data: asset, error: fetchErr } = await supabaseAdmin
      .from('assets')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .single();

    if (fetchErr || !asset) throw AppError.notFound(`Asset ${id} not found`);

    const { data: references } = await supabaseAdmin
      .from('asset_references')
      .select('*')
      .eq('asset_id', id);

    if (references && references.length > 0 && !force) {
      throw AppError.conflict(
        `Cannot delete asset ${id} because it is referenced in ${references.length} external locations.`,
        ErrorCodes.ASSET_IN_USE,
        { references }
      );
    }

    // Delete storage object
    const storage = getStorageProvider();
    await storage.delete(asset.storage_key, asset.storage_bucket);

    // Delete database records
    await supabaseAdmin.from('asset_references').delete().eq('asset_id', id);
    const { error: delErr } = await supabaseAdmin.from('assets').delete().eq('id', id);

    if (delErr) {
      throw AppError.internal(`Failed to delete asset: ${delErr.message}`);
    }

    webhookService
      .dispatchEvent(workspaceId, 'asset.deleted', {
        asset_id: id,
        deleted_at: new Date().toISOString(),
      })
      .catch((err) => console.warn('[Webhook] Dispatch error:', err.message));

    return { success: true, id, message: 'Asset purged successfully' };
  },

  async listAssetVersions(assetId: string, workspaceId: string = mockWorkspace.id): Promise<AssetVersion[]> {
    if (!isSupabaseAdminConfigured()) {
      return mockDb.assetVersions.filter((v) => v.asset_id === assetId).sort((a, b) => b.version_number - a.version_number);
    }
    const { data, error } = await supabaseAdmin
      .from('asset_versions')
      .select('*')
      .eq('asset_id', assetId)
      .order('version_number', { ascending: false });

    if (error) {
      throw AppError.internal(`Failed to list asset versions: ${error.message}`);
    }
    return (data as AssetVersion[]) || [];
  },

  async createAssetVersion(
    assetId: string,
    input: {
      storageKey: string;
      storageUrl?: string;
      sizeBytes: number;
      mimeType: string;
      checksum?: string;
      width?: number | null;
      height?: number | null;
      createdBy?: string;
      comment?: string;
    },
    workspaceId: string = mockWorkspace.id
  ): Promise<{ asset: Asset; archivedVersion: AssetVersion; versionNumber: number }> {
    const currentAsset = await this.getAssetById(assetId, workspaceId);
    if (!currentAsset) throw AppError.notFound(`Asset ${assetId} not found`);

    const versions = await this.listAssetVersions(assetId, workspaceId);
    const maxArchived = versions.length > 0 ? Math.max(...versions.map((v) => v.version_number)) : 0;
    const archivedVersionNumber = maxArchived + 1;
    const nextVersionNumber = archivedVersionNumber + 1;
    const now = new Date().toISOString();

    const archivedVersion: AssetVersion = {
      id: generateId('ver'),
      asset_id: assetId,
      version_number: archivedVersionNumber,
      storage_key: currentAsset.storage_key,
      storage_url: currentAsset.storage_url,
      size_bytes: currentAsset.size_bytes,
      mime_type: currentAsset.mime_type,
      checksum: currentAsset.checksum,
      width: currentAsset.width,
      height: currentAsset.height,
      created_by: currentAsset.created_by_user_id || currentAsset.created_by_service_account_id,
      comment: input.comment || `Archived prior to version ${nextVersionNumber}`,
      created_at: currentAsset.updated_at || currentAsset.created_at,
    };

    // Save archived version
    if (!isSupabaseAdminConfigured()) {
      mockDb.assetVersions.unshift(archivedVersion);
    } else {
      const { error: verErr } = await supabaseAdmin.from('asset_versions').insert(archivedVersion);
      if (verErr) {
        throw AppError.internal(`Failed to archive previous asset version: ${verErr.message}`);
      }
    }

    // Update active asset with new file details while keeping original asset.id
    const updatedFields: Partial<Asset> = {
      storage_key: input.storageKey,
      storage_url: input.storageUrl || currentAsset.storage_url,
      size_bytes: input.sizeBytes,
      mime_type: input.mimeType,
      extension: input.storageKey.split('.').pop() || currentAsset.extension,
      checksum: input.checksum || currentAsset.checksum,
      width: input.width !== undefined ? input.width : currentAsset.width,
      height: input.height !== undefined ? input.height : currentAsset.height,
      updated_at: now,
      metadata_json: {
        ...(currentAsset.metadata_json || {}),
        current_version: nextVersionNumber,
        last_replaced_at: now,
      },
    };

    let updatedAsset: Asset;
    if (!isSupabaseAdminConfigured()) {
      Object.assign(currentAsset, updatedFields);
      updatedAsset = currentAsset;
    } else {
      const { data, error } = await supabaseAdmin
        .from('assets')
        .update(updatedFields)
        .eq('id', assetId)
        .select()
        .single();

      if (error || !data) {
        throw AppError.internal(`Failed to update asset version: ${error?.message}`);
      }
      updatedAsset = data as Asset;
    }

    // Emit webhook
    try {
      await webhookService.dispatchEvent(workspaceId, 'asset.updated', {
        asset_id: assetId,
        event: 'version_replaced',
        version: nextVersionNumber,
        previous_version: archivedVersionNumber,
      });
    } catch {}

    return {
      asset: updatedAsset,
      archivedVersion,
      versionNumber: nextVersionNumber,
    };
  },

  async rollbackAssetVersion(
    assetId: string,
    targetVersionNumber: number,
    workspaceId: string = mockWorkspace.id
  ): Promise<Asset> {
    const currentAsset = await this.getAssetById(assetId, workspaceId);
    if (!currentAsset) throw AppError.notFound(`Asset ${assetId} not found`);

    let targetVersion: AssetVersion | undefined;
    if (!isSupabaseAdminConfigured()) {
      targetVersion = mockDb.assetVersions.find(
        (v) => v.asset_id === assetId && v.version_number === targetVersionNumber
      );
    } else {
      const { data, error } = await supabaseAdmin
        .from('asset_versions')
        .select('*')
        .eq('asset_id', assetId)
        .eq('version_number', targetVersionNumber)
        .maybeSingle();

      if (error || !data) {
        throw AppError.notFound(`Version ${targetVersionNumber} not found for asset ${assetId}`);
      }
      targetVersion = data as AssetVersion;
    }

    if (!targetVersion) {
      throw AppError.notFound(`Version ${targetVersionNumber} not found for asset ${assetId}`);
    }

    // Call createAssetVersion with the target version's data to roll forward
    const result = await this.createAssetVersion(
      assetId,
      {
        storageKey: targetVersion.storage_key,
        storageUrl: targetVersion.storage_url || undefined,
        sizeBytes: targetVersion.size_bytes,
        mimeType: targetVersion.mime_type,
        checksum: targetVersion.checksum || undefined,
        width: targetVersion.width,
        height: targetVersion.height,
        comment: `Rollback to version ${targetVersionNumber}`,
      },
      workspaceId
    );

    return result.asset;
  },
};
