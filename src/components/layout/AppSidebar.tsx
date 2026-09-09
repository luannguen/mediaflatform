'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth/AuthContext';
import {
  LayoutDashboard,
  Image as ImageIcon,
  FolderTree,
  Boxes,
  Trash2,
  KeyRound,
  Code2,
  Settings,
  ShieldCheck,
  HardDrive,
  ExternalLink,
  BarChart3,
} from 'lucide-react';

const navigation = [
  {
    category: 'OVERVIEW',
    items: [
      { name: 'Dashboard', href: '/', icon: LayoutDashboard },
      { name: 'Analytics & Bandwidth', href: '/analytics', icon: BarChart3 },
    ],
  },
  {
    category: 'MEDIA ASSETS',
    items: [
      { name: 'Library', href: '/library', icon: ImageIcon },
      { name: 'Folders', href: '/folders', icon: FolderTree },
      { name: 'Collections', href: '/collections', icon: Boxes },
      { name: 'Trash Bin', href: '/trash', icon: Trash2 },
    ],
  },
  {
    category: 'DEVELOPERS',
    items: [
      { name: 'Apps & API Keys', href: '/developers', icon: KeyRound },
      { name: 'Interactive API Docs', href: '/docs', icon: Code2 },
    ],
  },
  {
    category: 'ADMINISTRATION',
    items: [
      { name: 'Workspace Settings', href: '/settings', icon: Settings },
    ],
  },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { user } = useAuth();

  return (
    <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col flex-shrink-0 h-screen sticky top-0">
      {/* Brand Header */}
      <div className="p-5 border-b border-slate-800 flex items-center gap-3">
        <div className="h-9 w-9 rounded-xl bg-violet-600 flex items-center justify-center text-white font-bold shadow-lg shadow-violet-600/30">
          <HardDrive className="h-5 w-5" />
        </div>
        <div>
          <h1 className="font-semibold text-slate-100 text-sm tracking-wide">MEDIA PLATFORM</h1>
          <p className="text-xs text-violet-400 font-medium">Headless DAM Service</p>
        </div>
      </div>

      {/* Navigation Groups */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {navigation.map((group) => (
          <div key={group.category}>
            <div className="px-3 mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {group.category}
            </div>
            <div className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-violet-600/15 text-violet-400 border border-violet-500/20'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                    }`}
                  >
                    <Icon className={`h-4 w-4 ${isActive ? 'text-violet-400' : 'text-slate-400'}`} />
                    <span>{item.name}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer Info */}
      <div className="p-4 border-t border-slate-800 bg-slate-950/40">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            Zero-Trust RBAC
          </span>
          <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-800 text-violet-400 font-semibold border border-slate-700">
            {user?.role || 'viewer'}
          </span>
        </div>
        <div className="text-[11px] text-slate-400 truncate">
          {user?.name || 'Guest User'}
        </div>
      </div>
    </aside>
  );
}
