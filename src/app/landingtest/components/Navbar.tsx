'use client';

import React from 'react';
import Link from 'next/link';
import { Layers, Sparkles, Code2, BookOpen, ExternalLink, ArrowRight } from 'lucide-react';

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 backdrop-blur-md bg-slate-950/80 border-b border-slate-800/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand Logo */}
        <Link href="/landingtest" className="flex items-center gap-3 group">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 via-indigo-500 to-purple-600 p-0.5 shadow-lg shadow-sky-500/20 group-hover:scale-105 transition-transform duration-200">
            <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
              <Layers className="w-5 h-5 text-sky-400 group-hover:text-sky-300 transition-colors" />
            </div>
          </div>
          <div>
            <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
              MediaPlatform
            </span>
            <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
              Demo Hub
            </span>
          </div>
        </Link>

        {/* Navigation Links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-300">
          <a href="#gallery" className="hover:text-sky-400 transition-colors">
            Live Gallery
          </a>
          <a href="#transformation" className="hover:text-sky-400 transition-colors">
            CDN Lab
          </a>
          <a href="#picker" className="hover:text-sky-400 transition-colors">
            Picker Widget
          </a>
          <a href="#api-console" className="hover:text-sky-400 transition-colors">
            API Console
          </a>
          <a href="#features" className="hover:text-sky-400 transition-colors">
            Tính Năng
          </a>
          <Link href="/docs" className="flex items-center gap-1.5 hover:text-sky-400 transition-colors text-slate-400">
            <BookOpen className="w-4 h-4" />
            Docs & API
          </Link>
        </nav>

        {/* Action CTAs */}
        <div className="flex items-center gap-3">
          <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            API v1 Online
          </div>

          <Link
            href="/login"
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white shadow-lg shadow-sky-500/25 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
          >
            Dashboard
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </header>
  );
}
