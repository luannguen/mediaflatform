import { Folder } from '@/types/database';
import { AppError } from '@/lib/errors/app-error';
import { generateId } from '@/lib/ids/generator';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { mockDb, mockWorkspace } from '@/lib/mock/store';

export const folderService = {
  async listFolders(workspaceId: string = mockWorkspace.id, parentFolderId?: string | null): Promise<Folder[]> {
    if (isSupabaseAdminConfigured()) {
      try {
        let query = supabaseAdmin
          .from('folders')
          .select('*')
          .eq('workspace_id', workspaceId)
          .is('deleted_at', null)
          .order('name', { ascending: true });

        if (parentFolderId !== undefined) {
          if (parentFolderId === null) {
            query = query.is('parent_folder_id', null);
          } else {
            query = query.eq('parent_folder_id', parentFolderId);
          }
        }

        const { data, error } = await query;
        if (!error && data) return (data as Folder[]) || [];
      } catch {
        // Fallback to in-memory store
      }
    }

    let list = mockDb.folders.filter((f) => f.workspace_id === workspaceId && !f.deleted_at);
    if (parentFolderId !== undefined) {
      list = list.filter((f) => f.parent_folder_id === parentFolderId);
    }
    return list;
  },

  async createFolder(
    workspaceId: string = mockWorkspace.id,
    name: string,
    parentFolderId?: string | null
  ): Promise<Folder> {
    const id = generateId('fld');
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const now = new Date().toISOString();

    const folder: Folder = {
      id,
      workspace_id: workspaceId,
      parent_folder_id: parentFolderId || null,
      name,
      slug,
      created_at: now,
      updated_at: now,
    };

    if (isSupabaseAdminConfigured()) {
      try {
        const { data, error } = await supabaseAdmin.from('folders').insert(folder).select().single();
        if (!error && data) return data as Folder;
      } catch {
        // Fallback to in-memory store
      }
    }

    mockDb.folders.push(folder);
    return folder;
  },

  async deleteFolder(id: string, workspaceId: string = mockWorkspace.id): Promise<boolean> {
    const now = new Date().toISOString();
    if (!isSupabaseAdminConfigured()) {
      const f = mockDb.folders.find((item) => item.id === id && item.workspace_id === workspaceId);
      if (!f) throw AppError.notFound(`Folder ${id} not found`);
      f.deleted_at = now;
      return true;
    }

    const { error } = await supabaseAdmin
      .from('folders')
      .update({ deleted_at: now })
      .eq('id', id)
      .eq('workspace_id', workspaceId);

    if (error) throw AppError.internal(`Failed to delete folder: ${error.message}`);
    return true;
  },
};
