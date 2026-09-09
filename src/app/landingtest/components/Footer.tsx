'use client';

import React from 'react';
import Link from 'next/link';
import { Layers, BookOpen, Terminal, Shield, ArrowUpRight } from 'lucide-react';
import { DEMO_CREDENTIALS } from './HeroSection';

export function Footer() {
  return (
    <footer className="bg-slate-950 border-t border-slate-800/80 py-12 text-slate-400 text-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 pb-10 border-b border-slate-800/80">
          {/* Brand & Mission */}
          <div className="md:col-span-2 space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-white">
                <Layers className="w-4 h-4" />
              </div>
              <span className="font-bold text-base text-white">MediaPlatform</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">
                v1.0 LTS
              </span>
            </div>
            <p className="text-slate-400 text-xs max-w-md leading-relaxed">
              Giải pháp Digital Asset Management (DAM-as-a-Service) độc lập dùng chung cho toàn bộ hệ sinh thái dự án: 
              E-commerce, Mobile App, Web App, CMS. Cung cấp Dynamic CDN, Safe Delete và Zero-Trust Multi-Tenancy.
            </p>
            <div className="pt-2 text-[11px] font-mono text-slate-500">
              Active Sandbox Workspace: <span className="text-slate-300 font-semibold">{DEMO_CREDENTIALS.workspaceName}</span> ({DEMO_CREDENTIALS.workspaceId})
            </div>
          </div>

          {/* Quick Links */}
          <div className="space-y-2">
            <h4 className="font-bold text-slate-200 text-xs uppercase tracking-wider mb-3">Tài Nguyên</h4>
            <ul className="space-y-2">
              <li>
                <Link href="/docs" className="hover:text-sky-400 transition-colors flex items-center gap-1">
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>Knowledge Hub (/docs)</span>
                </Link>
              </li>
              <li>
                <Link href="/docs" className="hover:text-sky-400 transition-colors flex items-center gap-1">
                  <Terminal className="w-3.5 h-3.5" />
                  <span>OpenAPI v1 Specification</span>
                </Link>
              </li>
              <li>
                <Link href="/picker" target="_blank" className="hover:text-sky-400 transition-colors flex items-center gap-1">
                  <span>Embeddable Picker (/picker)</span>
                  <ArrowUpRight className="w-3 h-3" />
                </Link>
              </li>
            </ul>
          </div>

          {/* Management */}
          <div className="space-y-2">
            <h4 className="font-bold text-slate-200 text-xs uppercase tracking-wider mb-3">Quản Trị</h4>
            <ul className="space-y-2">
              <li>
                <Link href="/login" className="hover:text-sky-400 transition-colors">
                  Đăng Nhập Dashboard
                </Link>
              </li>
              <li>
                <Link href="/assets" className="hover:text-sky-400 transition-colors">
                  Quản Lý Media Assets
                </Link>
              </li>
              <li>
                <Link href="/developers" className="hover:text-sky-400 transition-colors">
                  Developer API Keys & Webhooks
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom copyright */}
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-slate-500">
          <div>
            © {new Date().getFullYear()} MediaPlatform Enterprise DAM. Built for modern high-performance architectures.
          </div>
          <div className="flex items-center gap-4">
            <span>Next.js 15 App Router</span>
            <span>•</span>
            <span>Sharp CDN Delivery</span>
            <span>•</span>
            <span>PostgreSQL & Supabase Storage</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
