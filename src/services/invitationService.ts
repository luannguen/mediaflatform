import { WorkspaceInvitation, WorkspaceMembership } from '@/types/database';
import { mockDb } from '@/lib/mock/store';
import { generateId } from '@/lib/ids/generator';
import { AppError } from '@/lib/errors/app-error';
import { ErrorCodes } from '@/lib/errors/codes';
import { UserRole } from '@/lib/auth/session';

export const invitationService = {
  /**
   * List all pending invitations sent to a user's email address
   */
  async getPendingInvitationsForEmail(email: string): Promise<WorkspaceInvitation[]> {
    if (!email) return [];
    const normalizedEmail = email.toLowerCase().trim();
    return mockDb.invitations.filter(
      (inv) => inv.invitee_email.toLowerCase().trim() === normalizedEmail && inv.status === 'pending'
    );
  },

  /**
   * List all invitations issued by a specific workspace
   */
  async getWorkspaceInvitations(workspaceId: string): Promise<WorkspaceInvitation[]> {
    return mockDb.invitations.filter((inv) => inv.workspace_id === workspaceId);
  },

  /**
   * Create and send an invitation to join a workspace
   */
  async createInvitation(
    workspaceId: string,
    inviter: { id: string; name: string },
    inviteeEmail: string,
    role: UserRole
  ): Promise<WorkspaceInvitation> {
    const normalizedEmail = inviteeEmail.toLowerCase().trim();
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      throw AppError.badRequest('A valid email address is required', ErrorCodes.VALIDATION_ERROR);
    }

    const ws = mockDb.workspaces.find((w) => w.id === workspaceId);
    if (!ws) {
      throw AppError.notFound('Target workspace not found', ErrorCodes.NOT_FOUND);
    }

    // Check if user is already a member
    const existingMember = mockDb.workspaceMemberships.find(
      (m) =>
        m.workspace_id === workspaceId &&
        m.status === 'active' &&
        m.user_email?.toLowerCase().trim() === normalizedEmail
    );
    if (existingMember) {
      throw AppError.conflict('User is already a member of this workspace', ErrorCodes.RESOURCE_CONFLICT);
    }

    // Check if pending invite already exists
    const existingInvite = mockDb.invitations.find(
      (inv) =>
        inv.workspace_id === workspaceId &&
        inv.invitee_email.toLowerCase().trim() === normalizedEmail &&
        inv.status === 'pending'
    );
    if (existingInvite) {
      return existingInvite;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days expiration

    const invitation: WorkspaceInvitation = {
      id: generateId('inv'),
      workspace_id: workspaceId,
      workspace_name: ws.name,
      inviter_user_id: inviter.id,
      inviter_name: inviter.name,
      invitee_email: normalizedEmail,
      role,
      status: 'pending',
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    };

    mockDb.invitations.push(invitation);
    return invitation;
  },

  /**
   * Accept an invitation and grant workspace membership
   */
  async acceptInvitation(
    invitationId: string,
    user: { id: string; email: string; name: string }
  ): Promise<{ workspaceId: string; workspaceName: string; role: UserRole }> {
    const normalizedEmail = user.email.toLowerCase().trim();
    const invitation = mockDb.invitations.find(
      (inv) =>
        inv.id === invitationId &&
        inv.invitee_email.toLowerCase().trim() === normalizedEmail &&
        inv.status === 'pending'
    );

    if (!invitation) {
      throw AppError.notFound('Invitation not found or already processed', ErrorCodes.NOT_FOUND);
    }

    // Check expiration
    if (new Date(invitation.expires_at).getTime() < Date.now()) {
      invitation.status = 'revoked';
      throw AppError.badRequest('This invitation has expired', ErrorCodes.VALIDATION_ERROR);
    }

    // Mark invitation as accepted
    invitation.status = 'accepted';

    // Add membership
    const now = new Date().toISOString();
    const existingMembershipIndex = mockDb.workspaceMemberships.findIndex(
      (m) => m.workspace_id === invitation.workspace_id && m.user_id === user.id
    );

    if (existingMembershipIndex >= 0) {
      mockDb.workspaceMemberships[existingMembershipIndex].status = 'active';
      mockDb.workspaceMemberships[existingMembershipIndex].role = invitation.role;
    } else {
      mockDb.workspaceMemberships.push({
        id: generateId('mem'),
        workspace_id: invitation.workspace_id,
        user_id: user.id,
        user_email: normalizedEmail,
        user_name: user.name,
        role_id: `role_${invitation.role}`,
        role: invitation.role,
        status: 'active',
        invited_by: invitation.inviter_user_id,
        joined_at: now,
        created_at: now,
        updated_at: now,
      });
    }

    return {
      workspaceId: invitation.workspace_id,
      workspaceName: invitation.workspace_name,
      role: invitation.role as UserRole,
    };
  },

  /**
   * Decline an invitation
   */
  async declineInvitation(invitationId: string, userEmail: string): Promise<boolean> {
    const normalizedEmail = userEmail.toLowerCase().trim();
    const invitation = mockDb.invitations.find(
      (inv) =>
        inv.id === invitationId &&
        inv.invitee_email.toLowerCase().trim() === normalizedEmail &&
        inv.status === 'pending'
    );

    if (!invitation) {
      throw AppError.notFound('Invitation not found', ErrorCodes.NOT_FOUND);
    }

    invitation.status = 'declined';
    return true;
  },

  /**
   * Revoke an invitation by workspace admin
   */
  async revokeInvitation(invitationId: string, workspaceId: string): Promise<boolean> {
    const invitation = mockDb.invitations.find(
      (inv) => inv.id === invitationId && inv.workspace_id === workspaceId
    );

    if (!invitation) {
      throw AppError.notFound('Invitation not found', ErrorCodes.NOT_FOUND);
    }

    invitation.status = 'revoked';
    return true;
  },
};
