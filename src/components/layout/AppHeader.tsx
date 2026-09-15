'use client';

import { useState } from 'react';
import {
  Search,
  Upload,
  ChevronDown,
  Building2,
  Lock,
  LogOut,
  Shield,
  Plus,
  Check,
  Mail,
} from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthContext';
import { Permissions } from '@/lib/security/rbac';
import { CreateWorkspaceModal } from '@/components/workspace/CreateWorkspaceModal';
import { InvitationsModal } from '@/components/workspace/InvitationsModal';

interface AppHeaderProps {
  onOpenUpload?: () => void;
  onSearch?: (term: string) => void;
}

export function AppHeader({ onOpenUpload, onSearch }: AppHeaderProps) {
  const [searchValue, setSearchValue] = useState('');
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [createWsModalOpen, setCreateWsModalOpen] = useState(false);
  const [invitationsModalOpen, setInvitationsModalOpen] = useState(false);
  const {
    user,
    workspace,
    workspaces,
    pendingInvitations,
    pendingInvitesCount,
    can,
    logout,
    switchWorkspace,
    createWorkspace,
    acceptInvitation,
    declineInvitation,
  } = useAuth();

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchValue(e.target.value);
    if (onSearch) onSearch(e.target.value);
  };

  const canUpload = can(Permissions.ASSET_CREATE);

  // Initials for avatar
  const initials = user?.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : 'U';

  const roleColors: Record<string, string> = {
    owner: 'bg-purple-950/60 text-purple-300 border-purple-500/30',
    admin: 'bg-violet-950/60 text-violet-300 border-violet-500/30',
    editor: 'bg-blue-950/60 text-blue-300 border-blue-500/30',
    viewer: 'bg-slate-800 text-slate-300 border-slate-700',
    developer: 'bg-emerald-950/60 text-emerald-300 border-emerald-500/30',
  };

  return (
    <>
      <header className="h-16 border-b border-slate-800 bg-slate-900/80 backdrop-blur px-2 sm:px-6 gap-2 flex items-center justify-between sticky top-0 z-20">
        {/* Dynamic Workspace Selector */}
        <div className="flex items-center gap-4">
          <div className="relative">
            <button
              aria-expanded={workspaceOpen}
              onClick={() => setWorkspaceOpen(!workspaceOpen)}
              className="flex items-center gap-1 sm:gap-2.5 px-2 sm:px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/80 text-sm font-medium text-slate-200 hover:bg-slate-700/80 transition min-h-[44px]"
            >
              <Building2 className="h-4 w-4 text-violet-400 flex-shrink-0" />
              <span className="max-w-[70px] sm:max-w-[200px] truncate font-medium">
                {workspace?.name || 'My Workspace'}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-slate-400 ml-1 flex-shrink-0" />
            </button>

            {workspaceOpen && (
              <div className="absolute top-full left-0 mt-2 w-72 rounded-2xl border border-slate-700 bg-slate-900/95 backdrop-blur-xl p-2 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-100">
                <div className="text-[11px] font-semibold text-slate-400 px-3 py-1.5 uppercase tracking-wider">
                  Your Workspaces ({workspaces.length})
                </div>

                <div className="max-h-64 overflow-y-auto space-y-1 my-1">
                  {workspaces.map((ws) => {
                    const isActive = ws.id === workspace?.id;
                    return (
                      <button
                        key={ws.id}
                        type="button"
                        onClick={() => {
                          setWorkspaceOpen(false);
                          if (!isActive) switchWorkspace(ws.id);
                        }}
                        className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left text-xs font-medium transition min-h-[44px] ${
                          isActive
                            ? 'bg-violet-600/20 text-violet-300 border border-violet-500/30'
                            : 'text-slate-300 hover:bg-slate-800/80 border border-transparent'
                        }`}
                      >
                        <div className="flex flex-col min-w-0 pr-2">
                          <span className="truncate font-semibold text-white">{ws.name}</span>
                          <span className="text-[10px] text-slate-400 capitalize">{ws.role} role</span>
                        </div>
                        {isActive && <Check className="h-4 w-4 text-violet-400 flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>

                <div className="pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setWorkspaceOpen(false);
                      setCreateWsModalOpen(true);
                    }}
                    className="w-full flex items-center gap-2 p-2 rounded-xl text-xs font-medium text-violet-400 hover:bg-violet-950/40 hover:text-violet-300 transition min-h-[44px]"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Create New Workspace</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Center Search */}
        {onSearch && <div className="flex-1 max-w-md mx-4 sm:mx-6 hidden md:block">
          <div className="relative">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              aria-label="Search assets"
              placeholder="Search assets by name, ID (med_...), or tags..."
              value={searchValue}
              onChange={handleSearchChange}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-1.5 text-sm text-slate-200 placeholder-slate-400 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition min-h-[44px]"
            />
          </div>
        </div>

        }
        {/* Right Actions */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-3">
          {/* Pending Invitations Badge Button */}
          <button
            type="button"
            onClick={() => setInvitationsModalOpen(true)}
            className="relative p-2.5 rounded-xl border border-slate-800 bg-slate-950/60 hover:bg-slate-800 text-slate-300 hover:text-white transition min-h-[44px] min-w-[44px] flex items-center justify-center"
            title="Workspace Invitations"
          >
            <Mail className="h-4 w-4" />
            {pendingInvitesCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-violet-600 text-[10px] font-bold text-white shadow-lg animate-pulse">
                {pendingInvitesCount}
              </span>
            )}
          </button>

          {/* Permission-Aware Upload Button */}
          {onOpenUpload && (
            canUpload ? (
              <button
                aria-label="Upload Media"
                onClick={onOpenUpload}
                className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-violet-600 text-white text-xs sm:text-sm font-semibold hover:bg-violet-500 transition shadow-lg shadow-violet-600/20 min-h-[44px]"
              >
                <Upload className="h-4 w-4" />
                <span className="hidden sm:inline">Upload Media</span>
              </button>
            ) : (
              <button
                disabled
                title="Upload requires Editor or Uploader role"
                className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-800 text-slate-400 text-xs sm:text-sm font-medium border border-slate-700 cursor-not-allowed opacity-60 min-h-[44px]"
              >
                <Lock className="h-3.5 w-3.5 text-amber-400" />
                <span className="hidden sm:inline">Upload (Locked)</span>
              </button>
            )
          )}

          {/* User Account & RBAC Dropdown */}
          <div className="relative">
            <button
              aria-label="Account menu"
              aria-expanded={userMenuOpen}
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="flex items-center gap-2.5 p-1 pl-2.5 pr-2 rounded-full border border-slate-700 bg-slate-800 hover:bg-slate-700 transition min-h-[44px]"
            >
              <div className="text-right hidden sm:block">
                <div className="text-xs font-semibold text-slate-200 line-clamp-1 max-w-[120px]">
                  {user?.name || 'User'}
                </div>
                <div className="text-[10px] uppercase font-mono tracking-wide text-violet-400">
                  {user?.role || 'viewer'}
                </div>
              </div>
              <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-violet-600 to-purple-600 border border-violet-400/30 flex items-center justify-center text-xs font-bold text-white shadow-sm">
                {initials}
              </div>
              <ChevronDown className="h-3 w-3 text-slate-400" />
            </button>

            {userMenuOpen && (
              <div className="absolute top-full right-0 mt-2 w-72 rounded-2xl border border-slate-700 bg-slate-900/95 backdrop-blur-xl p-3 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-100">
                {/* Profile Header */}
                <div className="p-2 border-b border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white truncate max-w-[170px]">{user?.name}</span>
                    <span
                      className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded-full border ${
                        roleColors[user?.role || 'viewer']
                      }`}
                    >
                      {user?.role}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5 truncate">{user?.email}</div>
                </div>

                {/* Sign out */}
                <button
                  onClick={() => {
                    setUserMenuOpen(false);
                    logout();
                  }}
                  className="w-full mt-2 flex items-center gap-2 p-2.5 rounded-xl text-xs font-medium text-rose-400 hover:bg-rose-950/30 hover:text-rose-300 transition min-h-[44px]"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Sign out</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Modals */}
      <CreateWorkspaceModal
        isOpen={createWsModalOpen}
        onClose={() => setCreateWsModalOpen(false)}
        onCreate={createWorkspace}
      />

      <InvitationsModal
        isOpen={invitationsModalOpen}
        onClose={() => setInvitationsModalOpen(false)}
        invitations={pendingInvitations}
        onAccept={acceptInvitation}
        onDecline={declineInvitation}
      />
    </>
  );
}
