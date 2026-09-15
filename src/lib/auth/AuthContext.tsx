'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { UserRole } from './session';
import { Permissions, PermissionAction } from '@/lib/security/rbac';
import { WorkspaceInvitation } from '@/types/database';
import { toast } from 'sonner';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface AuthWorkspace {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  quota_storage_bytes?: number;
  quota_asset_count?: number;
}

export interface AuthWorkspaceItem {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  role: UserRole;
  quota_storage_bytes: number;
  quota_asset_count: number;
}

interface RegisterPayload {
  name: string;
  email: string;
  password: string;
  workspaceName?: string;
}

interface AuthContextType {
  user: AuthUser | null;
  workspace: AuthWorkspace | null;
  workspaces: AuthWorkspaceItem[];
  pendingInvitations: WorkspaceInvitation[];
  pendingInvitesCount: number;
  loading: boolean;
  can: (action: PermissionAction) => boolean;
  login: (email?: string, password?: string, roleKey?: string) => Promise<boolean>;
  register: (payload: RegisterPayload) => Promise<{ success: boolean; requiresConfirmation?: boolean; error?: string }>;
  logout: () => Promise<void>;
  switchWorkspace: (workspaceId: string) => Promise<boolean>;
  createWorkspace: (name: string, description?: string) => Promise<boolean>;
  acceptInvitation: (invitationId: string) => Promise<boolean>;
  declineInvitation: (invitationId: string) => Promise<boolean>;
  refreshWorkspaces: () => Promise<void>;
  refreshInvitations: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Role to permissions mapping for client-side UI awareness (Section 124)
 */
const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  owner: ['*'],
  admin: ['*'],
  media_manager: [
    'asset.*',
    'folder.*',
    'collection.*',
    'usage.read',
    'audit.read',
    'member.read',
  ],
  editor: [
    'asset.read',
    'asset.create',
    'asset.update',
    'asset.delete',
    'asset.restore',
    'folder.read',
    'folder.create',
    'folder.update',
    'collection.read',
    'collection.create',
    'collection.update',
    'usage.read',
  ],
  uploader: [
    'asset.read',
    'asset.create',
    'folder.read',
    'collection.read',
  ],
  viewer: [
    'asset.read',
    'folder.read',
    'collection.read',
    'usage.read',
  ],
  developer: [
    'asset.read',
    'asset.create',
    'application.*',
    'apikey.*',
    'webhook.*',
    'audit.read',
  ],
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [workspace, setWorkspace] = useState<AuthWorkspace | null>(null);
  const [workspaces, setWorkspaces] = useState<AuthWorkspaceItem[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<WorkspaceInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const fetchWorkspaces = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/workspaces');
      if (res.ok) {
        const json = await res.json();
        setWorkspaces(json.data || []);
      }
    } catch {
      // Ignore network errors in background poll
    }
  }, []);

  const fetchInvitations = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/invitations');
      if (res.ok) {
        const json = await res.json();
        setPendingInvitations(json.data || []);
      }
    } catch {
      // Ignore background errors
    }
  }, []);

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/auth/me');
      if (res.ok) {
        const json = await res.json();
        setUser(json.data.user);
        setWorkspace(json.data.workspace);
        // Load workspaces & invitations in parallel
        await Promise.all([fetchWorkspaces(), fetchInvitations()]);
      } else {
        setUser(null);
        setWorkspace(null);
        setWorkspaces([]);
        setPendingInvitations([]);
      }
    } catch {
      setUser(null);
      setWorkspace(null);
      setWorkspaces([]);
      setPendingInvitations([]);
    } finally {
      setLoading(false);
    }
  }, [fetchWorkspaces, fetchInvitations]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  /**
   * Permission-aware check helper (Section 124)
   */
  const can = (action: PermissionAction): boolean => {
    if (!user) return false;
    const permissions = ROLE_PERMISSIONS[user.role] || [];
    if (permissions.includes('*')) return true;

    return permissions.some((perm) => {
      if (perm === action) return true;
      if (perm.endsWith('.*')) {
        const domain = perm.replace('.*', '');
        return action.startsWith(`${domain}.`);
      }
      return false;
    });
  };

  const login = async (email?: string, password?: string, roleKey?: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, roleKey }),
      });

      if (res.ok) {
        const json = await res.json();
        setUser(json.data.user);
        setWorkspace(json.data.workspace);
        await Promise.all([fetchWorkspaces(), fetchInvitations()]);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const register = async (payload: RegisterPayload): Promise<{ success: boolean; requiresConfirmation?: boolean; error?: string }> => {
    try {
      const res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok) {
        return { success: false, error: json.error?.message || 'Registration failed' };
      }

      if (json.data.requires_confirmation) return { success: true, requiresConfirmation: true };
      setUser(json.data.user);
      setWorkspace(json.data.workspace);
      await Promise.all([fetchWorkspaces(), fetchInvitations()]);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error during registration' };
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      setWorkspace(null);
      setWorkspaces([]);
      setPendingInvitations([]);
      router.push('/login');
      router.refresh();
    }
  };

  const switchWorkspace = async (workspaceId: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/v1/workspaces/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      });

      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message || 'Failed to switch workspace');
        return false;
      }

      setWorkspace(json.data.workspace);
      if (user) {
        setUser({ ...user, role: json.data.user.role });
      }
      toast.success(`Switched to ${json.data.workspace.name}`);
      router.refresh();
      return true;
    } catch (err: any) {
      toast.error(err.message || 'Failed to switch workspace');
      return false;
    }
  };

  const createWorkspace = async (name: string, description?: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/v1/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });

      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message || 'Failed to create workspace');
        return false;
      }

      toast.success(`Workspace "${name}" created`);
      await fetchWorkspaces();
      // Auto-switch to newly created workspace
      await switchWorkspace(json.data.id);
      return true;
    } catch (err: any) {
      toast.error(err.message || 'Failed to create workspace');
      return false;
    }
  };

  const acceptInvitation = async (invitationId: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/v1/invitations/${invitationId}/accept`, {
        method: 'POST',
      });

      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message || 'Failed to accept invitation');
        return false;
      }

      toast.success(`Joined workspace ${json.data.workspaceName}`);
      await Promise.all([fetchWorkspaces(), fetchInvitations()]);
      // Optionally switch to the joined workspace
      if (json.data.workspaceId) {
        await switchWorkspace(json.data.workspaceId);
      }
      return true;
    } catch (err: any) {
      toast.error(err.message || 'Failed to accept invitation');
      return false;
    }
  };

  const declineInvitation = async (invitationId: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/v1/invitations/${invitationId}/decline`, {
        method: 'POST',
      });

      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error?.message || 'Failed to decline invitation');
        return false;
      }

      toast.info('Invitation declined');
      await fetchInvitations();
      return true;
    } catch (err: any) {
      toast.error(err.message || 'Failed to decline invitation');
      return false;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        workspace,
        workspaces,
        pendingInvitations,
        pendingInvitesCount: pendingInvitations.length,
        loading,
        can,
        login,
        register,
        logout,
        switchWorkspace,
        createWorkspace,
        acceptInvitation,
        declineInvitation,
        refreshWorkspaces: fetchWorkspaces,
        refreshInvitations: fetchInvitations,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
