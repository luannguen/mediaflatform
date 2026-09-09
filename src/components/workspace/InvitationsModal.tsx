'use client';

import { useState } from 'react';
import { X, Mail, Check, Building2, User, Clock, ShieldCheck } from 'lucide-react';
import { WorkspaceInvitation } from '@/types/database';

interface InvitationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  invitations: WorkspaceInvitation[];
  onAccept: (invitationId: string) => Promise<boolean>;
  onDecline: (invitationId: string) => Promise<boolean>;
}

export function InvitationsModal({
  isOpen,
  onClose,
  invitations,
  onAccept,
  onDecline,
}: InvitationsModalProps) {
  const [processingId, setProcessingId] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleAction = async (id: string, action: 'accept' | 'decline') => {
    setProcessingId(id);
    if (action === 'accept') {
      await onAccept(id);
    } else {
      await onDecline(id);
    }
    setProcessingId(null);
  };

  const roleColors: Record<string, string> = {
    owner: 'bg-purple-950/80 text-purple-300 border-purple-500/30',
    admin: 'bg-violet-950/80 text-violet-300 border-violet-500/30',
    editor: 'bg-blue-950/80 text-blue-300 border-blue-500/30',
    viewer: 'bg-slate-800 text-slate-300 border-slate-700',
    developer: 'bg-emerald-950/80 text-emerald-300 border-emerald-500/30',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-violet-600/20 text-violet-400">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-100">Workspace Invitations</h3>
              <p className="text-xs text-slate-400">Collaborate in team and agency media spaces</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 max-h-[60vh] overflow-y-auto space-y-3">
          {invitations.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              <ShieldCheck className="h-10 w-10 text-slate-600 mx-auto mb-2 opacity-50" />
              <p className="text-sm font-medium text-slate-300">No pending invitations</p>
              <p className="text-xs mt-1 text-slate-500">
                When teams invite your email to join their workspace, they will appear here.
              </p>
            </div>
          ) : (
            invitations.map((inv) => {
              const isProcessing = processingId === inv.id;
              return (
                <div
                  key={inv.id}
                  className="p-4 rounded-xl border border-slate-800 bg-slate-950/70 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-lg bg-slate-800 text-violet-400">
                        <Building2 className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-white">
                          {inv.workspace_name}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5">
                          <User className="h-3 w-3" />
                          <span>Invited by {inv.inviter_name}</span>
                        </div>
                      </div>
                    </div>
                    <span
                      className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded-full border ${
                        roleColors[inv.role] || roleColors.viewer
                      }`}
                    >
                      {inv.role}
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                    <div className="flex items-center gap-1 text-[11px] text-slate-500">
                      <Clock className="h-3 w-3" />
                      <span>Expires in 7 days</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => handleAction(inv.id, 'decline')}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition disabled:opacity-50 min-h-[44px]"
                      >
                        Decline
                      </button>
                      <button
                        type="button"
                        disabled={isProcessing}
                        onClick={() => handleAction(inv.id, 'accept')}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-md shadow-violet-600/20 transition disabled:opacity-50 min-h-[44px]"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>{isProcessing ? 'Joining...' : 'Accept & Join'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
