import { Tag } from '@/types/database';
import { generateId } from '@/lib/ids/generator';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { mockWorkspace } from '@/lib/mock/store';
import { AppError } from '@/lib/errors/app-error';

const inMemoryTags: Tag[] = [];

export const tagService = {
  async listTags(workspaceId: string = mockWorkspace.id): Promise<Tag[]> {
    if (!isSupabaseAdminConfigured()) {
      return inMemoryTags.filter((t) => t.workspace_id === workspaceId);
    }
    const { data, error } = await supabaseAdmin.from('tags').select('*').eq('workspace_id', workspaceId).order('name');
    if (error) throw AppError.internal(`Failed to list tags: ${error.message}`);
    return (data as Tag[]) || [];
  },

  async createTag(workspaceId: string = mockWorkspace.id, name: string, description?: string): Promise<Tag> {
    const trimmed = name.trim();
    const normalized = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const now = new Date().toISOString();

    if (!isSupabaseAdminConfigured()) {
      const existing = inMemoryTags.find((t) => t.workspace_id === workspaceId && t.normalized_name === normalized);
      if (existing) return existing;

      const tag: Tag = {
        id: generateId('tag'),
        workspace_id: workspaceId,
        name: trimmed,
        normalized_name: normalized,
        description: description || null,
        created_at: now,
      };
      inMemoryTags.push(tag);
      return tag;
    }

    const { data, error } = await supabaseAdmin
      .from('tags')
      .upsert(
        {
          id: generateId('tag'),
          workspace_id: workspaceId,
          name: trimmed,
          normalized_name: normalized,
          description: description || null,
          created_at: now,
        },
        { onConflict: 'workspace_id,normalized_name' }
      )
      .select()
      .single();

    if (error) throw AppError.internal(`Failed to create tag: ${error.message}`);
    return data as Tag;
  },
};
