import { WorkspaceInvitation } from '@/types/database';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { AppError } from '@/lib/errors/app-error';
import { UserRole } from '@/lib/auth/session';

function fail(error: { message: string }): never {
  if (/WORKSPACE_ACCESS_DENIED|VERIFIED_IDENTITY_REQUIRED/.test(error.message)) throw AppError.forbidden('Verified workspace membership is required');
  if (/NOT_FOUND/.test(error.message)) throw AppError.notFound('Invitation not found');
  if (/ALREADY_MEMBER|EXPIRED_OR_PROCESSED/.test(error.message)) throw AppError.conflict('Invitation has expired, was processed, or the user is already a member');
  if (/INVALID_/.test(error.message)) throw AppError.badRequest('Invalid invitation');
  throw AppError.internal('Invitation persistence failed');
}

export const invitationService = {
  async getPendingInvitationsForEmail(email: string): Promise<WorkspaceInvitation[]> {
    const { data, error } = await supabaseAdmin.from('workspace_invitations').select('*')
      .eq('invitee_email', email.toLowerCase().trim()).eq('status', 'pending').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(100);
    if (error) fail(error);
    return data || [];
  },
  async getWorkspaceInvitations(workspaceId: string): Promise<WorkspaceInvitation[]> {
    const { data, error } = await supabaseAdmin.from('workspace_invitations').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(100);
    if (error) fail(error);
    return data || [];
  },
  async createInvitation(workspaceId: string, inviter: { id: string; name: string }, email: string, role: UserRole): Promise<WorkspaceInvitation> {
    const { data, error } = await supabaseAdmin.rpc('invite_workspace_member', { p_workspace_id: workspaceId, p_inviter_id: inviter.id, p_email: email, p_role: role });
    if (error) fail(error);
    return data;
  },
  async acceptInvitation(id: string, user: { id: string; email: string; name: string }) {
    const { data, error } = await supabaseAdmin.rpc('respond_workspace_invitation', { p_invitation_id: id, p_user_id: user.id, p_action: 'accepted' });
    if (error) fail(error);
    return { workspaceId: data.workspace_id, workspaceName: data.workspace_name, role: data.role as UserRole };
  },
  async declineInvitation(id: string, userId: string): Promise<boolean> {
    const { error } = await supabaseAdmin.rpc('respond_workspace_invitation', { p_invitation_id: id, p_user_id: userId, p_action: 'declined' });
    if (error) fail(error);
    return true;
  },
};
