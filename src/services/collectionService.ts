import { Collection } from '@/types/database';
import { AppError } from '@/lib/errors/app-error';
import { generateId } from '@/lib/ids/generator';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { mockDb, mockWorkspace } from '@/lib/mock/store';

export interface CollectionWithCount extends Collection {
  asset_count: number;
}

export const collectionService = {
  /**
   * List all collections in a workspace with their asset count
   */
  async listCollections(workspaceId: string = mockWorkspace.id): Promise<CollectionWithCount[]> {
    if (!isSupabaseAdminConfigured()) {
      return mockDb.collections
        .filter((c) => c.workspace_id === workspaceId)
        .map((c) => ({
          ...c,
          asset_count: 0,
        }));
    }

    const { data, error } = await supabaseAdmin
      .from('collections')
      .select('*, collection_assets(count)')
      .eq('workspace_id', workspaceId)
      .order('name', { ascending: true });

    if (error) throw AppError.internal(`Failed to list collections: ${error.message}`);

    return ((data || []) as any[]).map((col) => ({
      id: col.id,
      workspace_id: col.workspace_id,
      name: col.name,
      description: col.description,
      cover_asset_id: col.cover_asset_id,
      visibility: col.visibility,
      created_by: col.created_by,
      created_at: col.created_at,
      updated_at: col.updated_at,
      asset_count: col.collection_assets?.[0]?.count || 0,
    }));
  },

  /**
   * Get single collection by ID
   */
  async getCollection(workspaceId: string, collectionId: string): Promise<CollectionWithCount> {
    if (!isSupabaseAdminConfigured()) {
      const col = mockDb.collections.find((c) => c.id === collectionId && c.workspace_id === workspaceId);
      if (!col) throw AppError.notFound(`Collection ${collectionId} not found`);
      return { ...col, asset_count: 0 };
    }

    const { data, error } = await supabaseAdmin
      .from('collections')
      .select('*, collection_assets(count)')
      .eq('id', collectionId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (error || !data) throw AppError.notFound(`Collection ${collectionId} not found`);

    const col = data as any;
    return {
      id: col.id,
      workspace_id: col.workspace_id,
      name: col.name,
      description: col.description,
      cover_asset_id: col.cover_asset_id,
      visibility: col.visibility,
      created_by: col.created_by,
      created_at: col.created_at,
      updated_at: col.updated_at,
      asset_count: col.collection_assets?.[0]?.count || 0,
    };
  },

  /**
   * Create a new collection
   */
  async createCollection(
    workspaceId: string = mockWorkspace.id,
    name: string,
    description?: string,
    createdBy?: string
  ): Promise<CollectionWithCount> {
    if (!name || !name.trim()) {
      throw AppError.badRequest('Collection name is required');
    }

    const id = generateId('col');
    const now = new Date().toISOString();

    const collection: Collection = {
      id,
      workspace_id: workspaceId,
      name: name.trim(),
      description: description?.trim() || null,
      visibility: 'workspace',
      created_by: createdBy || null,
      created_at: now,
      updated_at: now,
    };

    if (!isSupabaseAdminConfigured()) {
      mockDb.collections.push(collection);
      return { ...collection, asset_count: 0 };
    }

    const { data, error } = await supabaseAdmin.from('collections').insert(collection).select().single();
    if (error) throw AppError.internal(`Failed to create collection: ${error.message}`);
    return { ...(data as Collection), asset_count: 0 };
  },

  /**
   * Delete a collection (cascade removes collection_assets)
   */
  async deleteCollection(workspaceId: string, collectionId: string): Promise<boolean> {
    if (!isSupabaseAdminConfigured()) {
      const idx = mockDb.collections.findIndex((c) => c.id === collectionId && c.workspace_id === workspaceId);
      if (idx === -1) throw AppError.notFound(`Collection ${collectionId} not found`);
      mockDb.collections.splice(idx, 1);
      return true;
    }

    const { error } = await supabaseAdmin
      .from('collections')
      .delete()
      .eq('id', collectionId)
      .eq('workspace_id', workspaceId);

    if (error) throw AppError.internal(`Failed to delete collection: ${error.message}`);
    return true;
  },

  /**
   * Add asset to collection
   */
  async addAssetToCollection(
    workspaceId: string,
    collectionId: string,
    assetId: string,
    addedBy?: string
  ): Promise<boolean> {
    // 1. Verify collection exists in workspace
    await this.getCollection(workspaceId, collectionId);

    if (!isSupabaseAdminConfigured()) {
      return true;
    }

    // 2. Verify asset belongs to workspace
    const { data: asset, error: assetErr } = await supabaseAdmin
      .from('assets')
      .select('id')
      .eq('id', assetId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (assetErr || !asset) {
      throw AppError.notFound(`Asset ${assetId} not found in workspace`);
    }

    // 3. Upsert into collection_assets
    const caId = generateId('ca');
    const { error: insErr } = await supabaseAdmin.from('collection_assets').upsert(
      {
        id: caId,
        collection_id: collectionId,
        asset_id: assetId,
        added_by: addedBy || null,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'collection_id,asset_id' }
    );

    if (insErr) throw AppError.internal(`Failed to add asset to collection: ${insErr.message}`);
    return true;
  },

  /**
   * Remove asset from collection
   */
  async removeAssetFromCollection(
    workspaceId: string,
    collectionId: string,
    assetId: string
  ): Promise<boolean> {
    // Verify collection exists in workspace
    await this.getCollection(workspaceId, collectionId);

    if (!isSupabaseAdminConfigured()) {
      return true;
    }

    const { error } = await supabaseAdmin
      .from('collection_assets')
      .delete()
      .eq('collection_id', collectionId)
      .eq('asset_id', assetId);

    if (error) throw AppError.internal(`Failed to remove asset from collection: ${error.message}`);
    return true;
  },

  /**
   * Get all collections an asset belongs to
   */
  async getAssetCollections(workspaceId: string, assetId: string): Promise<Collection[]> {
    if (!isSupabaseAdminConfigured()) {
      return [];
    }

    const { data, error } = await supabaseAdmin
      .from('collection_assets')
      .select('collection_id, collections(*)')
      .eq('asset_id', assetId);

    if (error || !data) return [];

    return data
      .map((item: any) => item.collections)
      .filter((c: any) => c && c.workspace_id === workspaceId);
  },
};
