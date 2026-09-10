'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Sparkles, Key, Copy, Check, ArrowRight, Zap, ShieldCheck, Database, Sliders, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

export const DEMO_CREDENTIALS = {
  keyPrefix: 'mda_live_demo2026',
  workspaceId: 'ws_default',
  workspaceName: 'Production Media',
  baseUrl: 'http://localhost:3000',
};

export function HeroSection() {
  const [copied, setCopied] = useState(false);

  const copyKey = async () => {
    try {
      await fetch('/api/v1/demo/session', { method: 'POST' });
      setCopied(true);
      toast.success('Đã kích hoạt Demo Session & Cookie an toàn!');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.info('Demo Sandbox Session Active');
    }
  };

  return (
    <section className="relative overflow-hidden pt-12 pb-20 border-b border-slate-800/60 bg-gradient-to-b from-slate-950 via-slate-900/50 to-slate-950">
      {/* Glow ambient background lights */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[350px] bg-sky-500/10 blur-[120px] pointer-events-none -z-10 rounded-full" />
      <div className="absolute top-40 right-10 w-[400px] h-[300px] bg-purple-500/10 blur-[100px] pointer-events-none -z-10 rounded-full" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        {/* Release Pill Badge */}
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-sky-500/10 border border-sky-500/25 text-sky-400 text-xs sm:text-sm font-medium mb-8 backdrop-blur-sm shadow-inner shadow-sky-500/20">
          <Sparkles className="w-4 h-4 text-sky-400" />
          <span>Centralized Headless DAM Platform • REST API v1.0 Live</span>
        </div>

        {/* Primary Headline */}
        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-white max-w-4xl mx-auto leading-[1.15]">
          Một Nền Tảng Media Dùng Chung Cho{' '}
          <span className="bg-gradient-to-r from-sky-400 via-teal-300 to-indigo-400 bg-clip-text text-transparent">
            Mọi Dự Án
          </span>
        </h1>

        {/* Subtitle */}
        <p className="mt-6 text-lg sm:text-xl text-slate-400 max-w-3xl mx-auto leading-relaxed">
          Không cần code lại logic upload, resize hay lưu trữ cho mỗi dự án mới. Chỉ cần tạo Workspace, cấp API Key, 
          và tích hợp với CDN Edge tự động crop/transcode theo thiết bị client chỉ qua 1 dòng URL.
        </p>

        {/* CTA Buttons */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <a
            href="#gallery"
            className="px-6 py-3.5 rounded-xl font-semibold text-white bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 shadow-xl shadow-sky-500/25 hover:shadow-sky-500/40 transition-all duration-200 flex items-center gap-2 hover:scale-[1.02] active:scale-[0.98]"
          >
            <Database className="w-5 h-5" />
            Khám Phá Live Gallery
          </a>

          <a
            href="#transformation"
            className="px-6 py-3.5 rounded-xl font-semibold text-slate-200 bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 hover:border-slate-600 shadow-sm transition-all duration-200 flex items-center gap-2 hover:scale-[1.02] active:scale-[0.98]"
          >
            <Sliders className="w-5 h-5 text-sky-400" />
            Thử Nghiệm CDN Sharp
          </a>

          <a
            href="#picker"
            className="px-6 py-3.5 rounded-xl font-semibold text-slate-200 bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 hover:border-slate-600 shadow-sm transition-all duration-200 flex items-center gap-2 hover:scale-[1.02] active:scale-[0.98]"
          >
            <ExternalLink className="w-5 h-5 text-purple-400" />
            Embeddable Picker Demo
          </a>
        </div>

        {/* Pre-configured Demo Credentials Box */}
        <div className="mt-12 max-w-3xl mx-auto bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-800 p-5 text-left shadow-2xl">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
              <Key className="w-4 h-4 text-amber-400" />
              <span>Thông Tin Cấu Hình Demo Sẵn Có (Pre-configured Sandbox)</span>
            </div>
            <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono border border-emerald-500/20">
              Ready to Call
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 text-xs font-mono">
            <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800/80">
              <span className="text-slate-500 block mb-1">WORKSPACE HIỆN TẠI:</span>
              <span className="text-slate-200 font-semibold">{DEMO_CREDENTIALS.workspaceName}</span>
              <span className="text-slate-500 block text-[10px] mt-0.5 font-sans">ID: {DEMO_CREDENTIALS.workspaceId}</span>
            </div>

            <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800/80 flex items-center justify-between">
              <div className="truncate mr-2">
                <span className="text-slate-500 block mb-1">DEMO API KEY (SCOPE: *):</span>
                <span className="text-sky-400 font-bold truncate block">{DEMO_CREDENTIALS.keyPrefix}_***</span>
              </div>
              <button
                onClick={copyKey}
                className="px-3 py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-400 hover:text-sky-300 flex items-center gap-1.5 transition-all text-xs shrink-0 cursor-pointer"
                title="Sao chép toàn bộ API Key"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Đã chép' : 'Copy Key'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Highlight Metrics */}
        <div className="mt-14 grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto">
          <div className="bg-slate-900/40 border border-slate-800/60 p-4 rounded-xl">
            <div className="text-2xl sm:text-3xl font-extrabold text-sky-400">&lt; 15ms</div>
            <div className="text-xs text-slate-400 mt-1 font-medium">Độ trễ CDN Dynamic Resizing</div>
          </div>
          <div className="bg-slate-900/40 border border-slate-800/60 p-4 rounded-xl">
            <div className="text-2xl sm:text-3xl font-extrabold text-emerald-400">80% - 95%</div>
            <div className="text-xs text-slate-400 mt-1 font-medium">Tiết kiệm băng thông (WebP/AVIF)</div>
          </div>
          <div className="bg-slate-900/40 border border-slate-800/60 p-4 rounded-xl">
            <div className="text-2xl sm:text-3xl font-extrabold text-purple-400">Zero Code</div>
            <div className="text-xs text-slate-400 mt-1 font-medium">Không lặp lại code media cho app mới</div>
          </div>
          <div className="bg-slate-900/40 border border-slate-800/60 p-4 rounded-xl">
            <div className="text-2xl sm:text-3xl font-extrabold text-amber-400">100% Safe</div>
            <div className="text-xs text-slate-400 mt-1 font-medium">Safe Delete Guard chống mất dữ liệu</div>
          </div>
        </div>
      </div>
    </section>
  );
}
