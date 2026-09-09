import { Collection } from '@/types/database';
import { AppError } from '@/lib/errors/app-error';
import { generateId } from '@/lib/ids/generator';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { mockDb, mockWorkspace } from '@/lib/mock/store';

export const collectionService = {
  async listCollections(workspaceId: string = mockWorkspace.id): Promise<Collection[]> {
    if (!isSupabaseAdminConfigured()) {
      return mockDb.collections.filter((c) => c.workspace_id === workspaceId);
    }

    const { data, error } = await supabaseAdmin
      .from('collections')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('name', { ascending: true });

    if (error) throw AppError.internal(`Failed to list collections: ${error.message}`);
    return (data as Collection[]) || [];
  },

  async createCollection(
    workspaceId: string = mockWorkspace.id,
    name: string,
    description?: string
  ): Promise<Collection> {
    const id = generateId('col');
    const now = new Date().toISOString();

    const collection: Collection = {
      id,
      workspace_id: workspaceId,
      name,
      description: description || null,
      visibility: 'workspace',
      created_at: now,
      updated_at: now,
    };

    if (!isSupabaseAdminConfigured()) {
      mockDb.collections.push(collection);
      return collection;
    }

    const { data, error } = await supabaseAdmin.from('collections').insert(collection).select().single();
    if (error) throw AppError.internal(`Failed to create collection: ${error.message}`);
    return data as Collection;
  },
};
