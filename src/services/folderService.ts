import { Folder } from '@/types/database';
import { AppError } from '@/lib/errors/app-error';
import { ErrorCodes } from '@/lib/errors/codes';
import { generateId } from '@/lib/ids/generator';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { mockDb, mockWorkspace } from '@/lib/mock/store';
import { isPersistentMode, isMockModeAllowed } from '@/lib/platform/persistence-mode';

export const folderService = {
  /**
   * List folders in a workspace.
   * Persistent mode: queries PostgreSQL, throws on error, never silently falls back to mockDb.
   */
  async listFolders(workspaceId: string = mockWorkspace.id, parentFolderId?: string | null): Promise<Folder[]> {
    if (isPersistentMode() && isSupabaseAdminConfigured()) {
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
      if (error) {
        throw AppError.internal(`Failed to list folders from database: ${error.message}`, ErrorCodes.INTERNAL_ERROR);
      }
      return (data as Folder[]) || [];
    }

    if (!isMockModeAllowed()) {
      throw AppError.internal(
        'Persistent database backend is required in production environment. Silent mock fallback is forbidden.',
        ErrorCodes.PERSISTENCE_ERROR
      );
    }

    let list = mockDb.folders.filter((f) => f.workspace_id === workspaceId && !f.deleted_at);
    if (parentFolderId !== undefined) {
      list = list.filter((f) => f.parent_folder_id === parentFolderId);
    }
    return list;
  },

  /**
   * Create a new folder.
   * Validates cross-tenant parent folder safety and enforces PostgreSQL persistence.
   */
  async createFolder(
    workspaceId: string = mockWorkspace.id,
    name: string,
    parentFolderId?: string | null
  ): Promise<Folder> {
    if (!name || !name.trim()) {
      throw AppError.badRequest('Folder name is required', ErrorCodes.VALIDATION_ERROR);
    }

    const id = generateId('fld');
    const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-');
    const now = new Date().toISOString();

    // Validate parent folder belongs to the same workspace
    if (parentFolderId) {
      if (isPersistentMode() && isSupabaseAdminConfigured()) {
        const { data: parentFolder, error: parentErr } = await supabaseAdmin
          .from('folders')
          .select('id, workspace_id')
          .eq('id', parentFolderId)
          .maybeSingle();

        if (parentErr || !parentFolder || parentFolder.workspace_id !== workspaceId) {
          throw AppError.badRequest(
            'Parent folder does not exist or does not belong to the target workspace',
            ErrorCodes.VALIDATION_ERROR
          );
        }
      } else if (isMockModeAllowed()) {
        const parentFolder = mockDb.folders.find((f) => f.id === parentFolderId && f.workspace_id === workspaceId);
        if (!parentFolder) {
          throw AppError.badRequest(
            'Parent folder does not exist or does not belong to the target workspace',
            ErrorCodes.VALIDATION_ERROR
          );
        }
      }
    }

    const folder: Folder = {
      id,
      workspace_id: workspaceId,
      parent_folder_id: parentFolderId || null,
      name: name.trim(),
      slug,
      created_at: now,
      updated_at: now,
    };

    if (isPersistentMode() && isSupabaseAdminConfigured()) {
      const { data, error } = await supabaseAdmin.from('folders').insert(folder).select().single();
      if (error) {
        throw AppError.internal(
          `Failed to persist folder in PostgreSQL: ${error.message}`,
          ErrorCodes.INTERNAL_ERROR
        );
      }
      return data as Folder;
    }

    if (!isMockModeAllowed()) {
      throw AppError.internal(
        'Persistent database backend is required in production environment. Silent mock fallback is forbidden.',
        ErrorCodes.PERSISTENCE_ERROR
      );
    }

    mockDb.folders.push(folder);
    return folder;
  },

  async deleteFolder(id: string, workspaceId: string = mockWorkspace.id): Promise<boolean> {
    const now = new Date().toISOString();
    if (isPersistentMode() && isSupabaseAdminConfigured()) {
      const { error } = await supabaseAdmin
        .from('folders')
        .update({ deleted_at: now })
        .eq('id', id)
        .eq('workspace_id', workspaceId);

      if (error) {
        throw AppError.internal(`Failed to delete folder: ${error.message}`, ErrorCodes.INTERNAL_ERROR);
      }
      return true;
    }

    if (!isMockModeAllowed()) {
      throw AppError.internal(
        'Persistent database backend is required in production environment. Silent mock fallback is forbidden.',
        ErrorCodes.PERSISTENCE_ERROR
      );
    }

    const f = mockDb.folders.find((item) => item.id === id && item.workspace_id === workspaceId);
    if (!f) throw AppError.notFound(`Folder ${id} not found`);
    f.deleted_at = now;
    return true;
  },
};
