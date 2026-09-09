'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { HardDrive, ShieldCheck, ArrowRight, Lock, Mail, User, Sparkles, Building2, UserPlus, LogIn } from 'lucide-react';
import { DEMO_USERS } from '@/lib/auth/session';
import { toast } from 'sonner';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get('redirect') || '/';

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeRoleKey, setActiveRoleKey] = useState<string | null>(null);
  const [isLocalHost, setIsLocalHost] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const hostname = window.location.hostname;
      setIsLocalHost(hostname === 'localhost' || hostname === '127.0.0.1');
    }
  }, []);

  const handleLogin = async (e?: React.FormEvent, roleKey?: string) => {
    if (e) e.preventDefault();
    setLoading(true);
    if (roleKey) setActiveRoleKey(roleKey);

    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, roleKey }),
      });

      const json = await res.json();

      if (!res.ok) {
        toast.error(json.error?.message || 'Login failed');
        setLoading(false);
        setActiveRoleKey(null);
        return;
      }

      toast.success(`Welcome back, ${json.data.user.name}!`);
      router.push(redirectUrl);
      router.refresh();
    } catch {
      toast.error('Network error during login');
      setLoading(false);
      setActiveRoleKey(null);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Please enter your full name');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      toast.error('Please enter a valid email address');
      return;
    }
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters long');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
          workspaceName: workspaceName.trim() || undefined,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        toast.error(json.error?.message || 'Registration failed');
        setLoading(false);
        return;
      }

      toast.success(`Account created! Welcome to ${json.data.workspace.name}`);
      router.push(redirectUrl);
      router.refresh();
    } catch {
      toast.error('Network error during registration');
      setLoading(false);
    }
  };


  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Background Glows */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-violet-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-purple-600/15 rounded-full blur-3xl pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="flex items-center justify-center gap-3 mb-4">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-tr from-violet-600 to-purple-500 flex items-center justify-center text-white font-bold shadow-xl shadow-violet-600/30">
            <HardDrive className="h-6 w-6" />
          </div>
        </div>
        <h2 className="text-center text-2xl font-bold tracking-tight text-white">
          MEDIA PLATFORM
        </h2>
        <p className="mt-1 text-center text-xs text-violet-400 font-medium">
          Zero-Trust Digital Asset Management & Unified Media Service
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-xl relative z-10 px-4">
        <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-800 py-8 px-6 shadow-2xl rounded-2xl sm:px-10">
          {/* Mode Switcher Tabs */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-950/80 rounded-xl border border-slate-800 mb-6">
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg transition min-h-[44px] ${
                mode === 'login'
                  ? 'bg-violet-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LogIn className="h-3.5 w-3.5" />
              <span>Sign In</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('register')}
              className={`flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg transition min-h-[44px] ${
                mode === 'register'
                  ? 'bg-violet-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <UserPlus className="h-3.5 w-3.5" />
              <span>Create Account</span>
            </button>
          </div>

          {mode === 'login' ? (
            /* ================= Sign In Form ================= */
            <form className="space-y-4" onSubmit={(e) => handleLogin(e)}>
              <div>
                <div className="mb-1.5">
                  <label className="block text-xs font-medium text-slate-300">
                    Email address
                  </label>
                </div>
                <div className="relative">
                  <Mail className="h-4 w-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition min-h-[44px]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <Lock className="h-4 w-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition min-h-[44px]"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || (!email && !password)}
                className="w-full mt-2 flex items-center justify-center gap-2 py-3 px-4 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold shadow-lg shadow-violet-600/25 transition disabled:opacity-50 min-h-[44px]"
              >
                {loading && !activeRoleKey ? (
                  <span>Signing in...</span>
                ) : (
                  <>
                    <span>Sign In with Credentials</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>
          ) : (
            /* ================= Registration Form ================= */
            <form className="space-y-4" onSubmit={handleRegister}>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Full Name <span className="text-rose-400">*</span>
                </label>
                <div className="relative">
                  <User className="h-4 w-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Johnathan Doe"
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition min-h-[44px]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Work Email <span className="text-rose-400">*</span>
                </label>
                <div className="relative">
                  <Mail className="h-4 w-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="john@company.com"
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition min-h-[44px]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Password <span className="text-rose-400">*</span> <span className="text-[10px] text-slate-400">(Min. 8 characters)</span>
                </label>
                <div className="relative">
                  <Lock className="h-4 w-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    required
                    minLength={8}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition min-h-[44px]"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-slate-300">
                    Workspace / Brand Name
                  </label>
                  <span className="text-[10px] text-slate-400">Optional</span>
                </div>
                <div className="relative">
                  <Building2 className="h-4 w-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    placeholder="e.g. Acme Media Lab (Defaults to your name)"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition min-h-[44px]"
                  />
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  A private, isolated workspace will be auto-provisioned with 10 GB storage and Owner privileges.
                </p>
              </div>

              <button
                type="submit"
                disabled={loading || !name || !email || password.length < 8}
                className="w-full mt-2 flex items-center justify-center gap-2 py-3 px-4 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold shadow-lg shadow-violet-600/25 transition disabled:opacity-50 min-h-[44px]"
              >
                {loading ? (
                  <span>Provisioning workspace...</span>
                ) : (
                  <>
                    <span>Create Account & Launch Workspace</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>
          )}

          {/* Quick Access Demo Identities: RESTRICTED TO LOCALHOST ONLY (Zero-Trust Guard) */}
          {isLocalHost && mode === 'login' && (
            <div className="mt-8 pt-6 border-t border-slate-800">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  ⚡ Quick Sign-in by Role (Localhost 3000 Only)
                </span>
                <span className="text-[10px] text-amber-400 bg-amber-950/40 border border-amber-500/20 px-2 py-0.5 rounded-full font-mono">
                  DEV MODE ONLY
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {Object.entries(DEMO_USERS).map(([key, item]) => {
                  const isLoadingThis = loading && activeRoleKey === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleLogin(undefined, key)}
                      disabled={loading}
                      className="flex flex-col text-left p-3 rounded-xl border border-slate-800 bg-slate-950/60 hover:bg-slate-800/80 hover:border-violet-500/30 transition group min-h-[44px]"
                    >
                      <div className="flex items-center justify-between w-full mb-1">
                        <span className="text-xs font-semibold text-slate-200 group-hover:text-violet-300 capitalize flex items-center gap-1.5">
                          {key === 'admin' && '👑'}
                          {key === 'editor' && '✍️'}
                          {key === 'viewer' && '👁️'}
                          {key === 'developer' && '💻'}
                          {key}
                        </span>
                        <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 group-hover:bg-violet-600/20 group-hover:text-violet-400">
                          {key}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                        {item.description}
                      </p>
                      {isLoadingThis && (
                        <span className="mt-2 text-[10px] text-violet-400 font-medium animate-pulse">
                          Authenticating...
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-6 pt-4 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              Tenant Boundary Protected
            </span>
            <span className="font-mono">Supabase Multi-Tenant Engine</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 text-sm">Loading security context...</div>}>
      <LoginForm />
    </Suspense>
  );
}
