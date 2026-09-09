import { AssetReference } from '@/types/database';
import { AppError } from '@/lib/errors/app-error';
import { generateId } from '@/lib/ids/generator';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { mockDb, mockWorkspace } from '@/lib/mock/store';

export interface CreateReferenceInput {
  workspaceId?: string;
  assetId: string;
  applicationId?: string;
  sourceApp: string;
  entityType: string;
  entityId: string;
  fieldName?: string;
  context?: Record<string, any>;
}

export interface SyncReferencesInput {
  workspaceId?: string;
  applicationId?: string;
  sourceApp: string;
  entityType: string;
  entityId: string;
  references: {
    assetId: string;
    fieldName?: string;
    context?: Record<string, any>;
  }[];
}

export const referenceService = {
  async listByAsset(assetId: string, workspaceId: string = mockWorkspace.id): Promise<AssetReference[]> {
    if (!isSupabaseAdminConfigured()) {
      return mockDb.references.filter((r) => r.asset_id === assetId && r.workspace_id === workspaceId);
    }

    const { data, error } = await supabaseAdmin
      .from('asset_references')
      .select('*')
      .eq('asset_id', assetId)
      .eq('workspace_id', workspaceId);

    if (error) throw AppError.internal(`Failed to fetch asset references: ${error.message}`);
    return (data as AssetReference[]) || [];
  },

  async createReference(input: CreateReferenceInput): Promise<AssetReference> {
    const id = generateId('ref');
    const workspaceId = input.workspaceId || mockWorkspace.id;
    const now = new Date().toISOString();

    const record: AssetReference = {
      id,
      workspace_id: workspaceId,
      asset_id: input.assetId,
      application_id: input.applicationId || null,
      source_app: input.sourceApp,
      entity_type: input.entityType,
      entity_id: input.entityId,
      field_name: input.fieldName || null,
      context: input.context || {},
      created_at: now,
      updated_at: now,
    };

    if (!isSupabaseAdminConfigured()) {
      // Avoid duplicate exact reference
      const existing = mockDb.references.find(
        (r) =>
          r.workspace_id === workspaceId &&
          r.asset_id === input.assetId &&
          r.source_app === input.sourceApp &&
          r.entity_type === input.entityType &&
          r.entity_id === input.entityId &&
          r.field_name === (input.fieldName || null)
      );
      if (existing) return existing;

      mockDb.references.push(record);
      return record;
    }

    const { data, error } = await supabaseAdmin
      .from('asset_references')
      .upsert(record, {
        onConflict: 'workspace_id,asset_id,source_app,entity_type,entity_id,field_name',
      })
      .select()
      .single();

    if (error) throw AppError.internal(`Failed to create reference: ${error.message}`);
    return data as AssetReference;
  },

  async deleteReference(id: string, workspaceId: string = mockWorkspace.id): Promise<boolean> {
    if (!isSupabaseAdminConfigured()) {
      mockDb.references = mockDb.references.filter((r) => r.id !== id);
      return true;
    }

    const { error } = await supabaseAdmin
      .from('asset_references')
      .delete()
      .eq('id', id)
      .eq('workspace_id', workspaceId);

    if (error) throw AppError.internal(`Failed to delete reference: ${error.message}`);
    return true;
  },

  /**
   * Sync references for a given entity (Atomic Replace / Sync)
   * Section 85 of Master Prompt: Client passes current state of references,
   * server removes stale references and registers new ones.
   */
  async syncReferences(input: SyncReferencesInput): Promise<{ count: number; synced: AssetReference[] }> {
    const workspaceId = input.workspaceId || mockWorkspace.id;

    if (!isSupabaseAdminConfigured()) {
      // Remove previous references for this entity
      mockDb.references = mockDb.references.filter(
        (r) =>
          !(
            r.workspace_id === workspaceId &&
            r.source_app === input.sourceApp &&
            r.entity_type === input.entityType &&
            r.entity_id === input.entityId
          )
      );

      const created: AssetReference[] = [];
      for (const item of input.references) {
        const ref = await this.createReference({
          workspaceId,
          applicationId: input.applicationId,
          sourceApp: input.sourceApp,
          entityType: input.entityType,
          entityId: input.entityId,
          assetId: item.assetId,
          fieldName: item.fieldName,
          context: item.context,
        });
        created.push(ref);
      }
      return { count: created.length, synced: created };
    }

    // Supabase Transactional Sync
    await supabaseAdmin
      .from('asset_references')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('source_app', input.sourceApp)
      .eq('entity_type', input.entityType)
      .eq('entity_id', input.entityId);

    const recordsToInsert = input.references.map((item) => ({
      id: generateId('ref'),
      workspace_id: workspaceId,
      asset_id: item.assetId,
      application_id: input.applicationId || null,
      source_app: input.sourceApp,
      entity_type: input.entityType,
      entity_id: input.entityId,
      field_name: item.fieldName || null,
      context: item.context || {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    if (recordsToInsert.length === 0) {
      return { count: 0, synced: [] };
    }

    const { data, error } = await supabaseAdmin.from('asset_references').insert(recordsToInsert).select();

    if (error) throw AppError.internal(`Failed to sync references: ${error.message}`);
    return { count: (data || []).length, synced: (data as AssetReference[]) || [] };
  },
};
