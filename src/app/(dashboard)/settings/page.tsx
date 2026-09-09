'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  HardDrive,
  RefreshCw,
  Users,
  UserPlus,
  Mail,
  ShieldCheck,
  Building2,
  Clock,
  Send,
} from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthContext';
import { WorkspaceMembership, WorkspaceInvitation } from '@/types/database';
import { UserRole } from '@/lib/auth/session';
import { toast } from 'sonner';

export default function WorkspaceSettingsPage() {
  const { workspace, user } = useAuth();
  const [members, setMembers] = useState<WorkspaceMembership[]>([]);
  const [sentInvites, setSentInvites] = useState<WorkspaceInvitation[]>([]);
  const [loading, setLoading] = useState(false);

  // Invite Form state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('editor');
  const [sendingInvite, setSendingInvite] = useState(false);

  const fetchTeamData = useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    try {
      // 1. Fetch members
      const memRes = await fetch(`/api/v1/workspaces/${workspace.id}/members`);
      if (memRes.ok) {
        const memJson = await memRes.json();
        setMembers(memJson.data || []);
      }

      // 2. Fetch sent invitations (only if owner/admin)
      if (user?.role === 'owner' || user?.role === 'admin') {
        const invRes = await fetch(`/api/v1/workspaces/${workspace.id}/invitations`);
        if (invRes.ok) {
          const invJson = await invRes.json();
          setSentInvites(invJson.data || []);
        }
      }
    } catch {
      // Ignore background fetch errors
    } finally {
      setLoading(false);
    }
  }, [workspace?.id, user?.role]);

  useEffect(() => {
    fetchTeamData();
  }, [fetchTeamData]);

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace?.id || !inviteEmail.trim()) return;

    setSendingInvite(true);
    try {
      const res = await fetch(`/api/v1/workspaces/${workspace.id}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });

      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message || 'Failed to send invitation');
        return;
      }

      toast.success(`Invitation sent to ${inviteEmail}`);
      setInviteEmail('');
      await fetchTeamData();
    } catch (err: any) {
      toast.error(err.message || 'Error sending invitation');
    } finally {
      setSendingInvite(false);
    }
  };

  const roleColors: Record<string, string> = {
    owner: 'bg-purple-950/80 text-purple-300 border-purple-500/30',
    admin: 'bg-violet-950/80 text-violet-300 border-violet-500/30',
    editor: 'bg-blue-950/80 text-blue-300 border-blue-500/30',
    viewer: 'bg-slate-800 text-slate-300 border-slate-700',
    developer: 'bg-emerald-950/80 text-emerald-300 border-emerald-500/30',
  };

  const isOwnerOrAdmin = user?.role === 'owner' || user?.role === 'admin';

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight">
            Workspace & Team Settings
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Manage multi-tenant storage quotas, access policies, and invite collaborators
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-xs font-medium text-slate-300">
            <Building2 className="h-3.5 w-3.5 text-violet-400" />
            <span>{workspace?.name || 'Current Workspace'}</span>
          </div>
        </div>
      </div>

      {/* Grid: Quotas and Policies */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Storage Configuration */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3 shadow-sm">
          <div className="flex items-center gap-2.5">
            <HardDrive className="h-5 w-5 text-violet-400" />
            <h3 className="text-sm font-semibold text-slate-200">Storage Provider & Quota</h3>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1.5 border-b border-slate-800/80">
              <span className="text-slate-400">Active Provider</span>
              <span className="text-slate-200 font-mono font-medium">Supabase Storage CDN</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-800/80">
              <span className="text-slate-400">Storage Bucket</span>
              <span className="text-slate-200 font-mono">media-assets</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-slate-400">Allocated Quota</span>
              <span className="text-slate-200 font-medium">10 GB (Multi-tenant isolated)</span>
            </div>
          </div>
        </div>

        {/* Retention Policy */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3 shadow-sm">
          <div className="flex items-center gap-2.5">
            <RefreshCw className="h-5 w-5 text-emerald-400" />
            <h3 className="text-sm font-semibold text-slate-200">Lifecycle & Safe Delete</h3>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1.5 border-b border-slate-800/80">
              <span className="text-slate-400">Trash Retention Window</span>
              <span className="text-slate-200">30 Days</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-slate-800/80">
              <span className="text-slate-400">Safe Delete Safeguard</span>
              <span className="text-emerald-400 font-medium">Enforced (Zero Orphaned Refs)</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-slate-400">Deduplication Engine</span>
              <span className="text-slate-200 font-mono">SHA-256 Checksum</span>
            </div>
          </div>
        </div>
      </div>

      {/* Team & Members Section */}
      <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <Users className="h-5 w-5 text-violet-400" />
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Team Members & Collaborators</h2>
              <p className="text-xs text-slate-400">Members who have access to this workspace</p>
            </div>
          </div>
        </div>

        {/* Invite New Member Form (Admin/Owner only) */}
        {isOwnerOrAdmin ? (
          <form
            onSubmit={handleSendInvite}
            className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3"
          >
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <UserPlus className="h-4 w-4 text-violet-400" />
              <span>Invite New Member by Email</span>
            </div>
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="relative flex-1 w-full">
                <Mail className="h-4 w-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="collaborator@agency.com"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500 min-h-[44px]"
                />
              </div>

              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as UserRole)}
                className="w-full sm:w-40 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-violet-500 min-h-[44px]"
              >
                <option value="editor">Editor (Upload/Edit)</option>
                <option value="admin">Admin (Manage)</option>
                <option value="viewer">Viewer (Read-only)</option>
                <option value="developer">Developer (API/Keys)</option>
              </select>

              <button
                type="submit"
                disabled={sendingInvite || !inviteEmail.trim()}
                className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-md shadow-violet-600/20 transition disabled:opacity-50 min-h-[44px]"
              >
                <Send className="h-3.5 w-3.5" />
                <span>{sendingInvite ? 'Sending...' : 'Send Invite'}</span>
              </button>
            </div>
          </form>
        ) : (
          <div className="p-3.5 rounded-xl bg-slate-950/40 border border-slate-800 text-xs text-slate-400 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-slate-500" />
            <span>Only workspace Owners and Admins can invite new members.</span>
          </div>
        )}

        {/* Current Active Members List */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Active Members ({members.length})
          </div>

          <div className="divide-y divide-slate-800/60 border border-slate-800 rounded-xl overflow-hidden bg-slate-950/40">
            {members.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-500">
                No active members found for this workspace.
              </div>
            ) : (
              members.map((m) => (
                <div key={m.id} className="p-3.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-xs font-bold text-violet-300">
                      {(m.user_name || m.user_email || 'U')[0].toUpperCase()}
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-white">
                        {m.user_name || m.user_email || m.user_id}
                      </div>
                      {m.user_email && (
                        <div className="text-[11px] text-slate-400">{m.user_email}</div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded-full border ${
                        roleColors[m.role || 'viewer'] || roleColors.viewer
                      }`}
                    >
                      {m.role || 'viewer'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Sent Pending Invitations */}
        {isOwnerOrAdmin && sentInvites.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-slate-800">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Pending Outgoing Invitations ({sentInvites.length})
            </div>

            <div className="divide-y divide-slate-800/60 border border-slate-800 rounded-xl overflow-hidden bg-slate-950/40">
              {sentInvites.map((inv) => (
                <div key={inv.id} className="p-3.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-slate-800 text-slate-400">
                      <Mail className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-white">{inv.invitee_email}</div>
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-0.5">
                        <Clock className="h-3 w-3" />
                        <span>Invited as {inv.role} • Status: {inv.status}</span>
                      </div>
                    </div>
                  </div>

                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-amber-950/40 border border-amber-500/20 text-amber-300">
                    {inv.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
