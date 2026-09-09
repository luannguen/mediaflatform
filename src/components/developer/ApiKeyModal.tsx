'use client';

import { useState, useEffect } from 'react';
import { X, Copy, Check, ShieldAlert, KeyRound, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  serviceAccounts: { id: string; name: string }[];
  onCreateKey: (name: string, serviceAccountId: string, scopes: string[]) => Promise<{ rawKey: string } | null>;
}

const AVAILABLE_SCOPES = [
  { id: 'assets:read', label: 'assets:read', desc: 'Read media assets and fetch delivery URLs' },
  { id: 'assets:write', label: 'assets:write', desc: 'Create and update media assets' },
  { id: 'assets:delete', label: 'assets:delete', desc: 'Trash and purge media assets' },
  { id: 'uploads:create', label: 'uploads:create', desc: 'Direct upload media sessions' },
  { id: 'references:read', label: 'references:read', desc: 'Inspect external entity usage' },
  { id: 'references:write', label: 'references:write', desc: 'Register and sync entity references' },
];

export function ApiKeyModal({ isOpen, onClose, serviceAccounts, onCreateKey }: ApiKeyModalProps) {
  const [name, setName] = useState('');
  const [serviceAccountId, setServiceAccountId] = useState(serviceAccounts[0]?.id || 'auto_default');
  const [selectedScopes, setSelectedScopes] = useState<string[]>([
    'assets:read',
    'assets:write',
    'uploads:create',
    'references:write',
  ]);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Sync serviceAccountId whenever serviceAccounts list updates or modal opens
  useEffect(() => {
    if (serviceAccounts.length > 0) {
      if (!serviceAccountId || serviceAccountId === 'auto_default' || !serviceAccounts.some((s) => s.id === serviceAccountId)) {
        setServiceAccountId(serviceAccounts[0].id);
      }
    } else {
      setServiceAccountId('auto_default');
    }
  }, [serviceAccounts, isOpen]);

  if (!isOpen) return null;

  const toggleScope = (scopeId: string) => {
    if (selectedScopes.includes(scopeId)) {
      setSelectedScopes(selectedScopes.filter((s) => s !== scopeId));
    } else {
      setSelectedScopes([...selectedScopes, scopeId]);
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Please enter key label/name');
      return;
    }

    const targetAccount = serviceAccountId || serviceAccounts[0]?.id || 'auto_default';

    setSubmitting(true);
    const result = await onCreateKey(name.trim(), targetAccount, selectedScopes);
    setSubmitting(false);

    if (result) {
      setGeneratedKey(result.rawKey);
    }
  };

  const handleCopy = () => {
    if (!generatedKey) return;
    navigator.clipboard.writeText(generatedKey);
    setCopied(true);
    toast.success('API key copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = () => {
    setGeneratedKey(null);
    setName('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-violet-600/10 text-violet-400">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-100">
                {generatedKey ? 'API Key Created' : 'Create New API Key'}
              </h3>
              <p className="text-xs text-slate-400">Scoped token for backend applications</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        {generatedKey ? (
          <div className="p-6 space-y-4">
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block mb-0.5">Copy this secret key now</span>
                For security reasons, this secret will never be displayed again. If you lose this key, you will need to revoke it and generate a new one.
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Secret API Key
              </label>
              <div className="relative">
                <input
                  type="text"
                  readOnly
                  value={generatedKey}
                  className="w-full bg-slate-950 border border-violet-500/50 rounded-lg pl-3 pr-24 py-2.5 text-xs text-violet-300 font-mono focus:outline-none select-all min-h-[44px]"
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-md bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium flex items-center gap-1.5 transition"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            <div className="pt-2">
              <button
                onClick={handleClose}
                className="w-full py-2.5 rounded-lg bg-slate-800 hover:bg-slate-750 text-sm font-medium text-slate-200 transition min-h-[44px]"
              >
                I have securely stored my key
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleGenerate} className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Key Label / Name <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Commerce Backend Production"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-violet-500 min-h-[44px]"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Assign to Service Account
                </label>
                {serviceAccounts.length === 0 && (
                  <span className="text-[10px] text-violet-400 font-medium flex items-center gap-1">
                    <Sparkles className="h-3 w-3" />
                    <span>Auto-provisions Account</span>
                  </span>
                )}
              </div>
              <select
                value={serviceAccountId}
                onChange={(e) => setServiceAccountId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-violet-500 min-h-[44px]"
              >
                {serviceAccounts.length > 0 ? (
                  <>
                    {serviceAccounts.map((svc) => (
                      <option key={svc.id} value={svc.id}>
                        {svc.name}
                      </option>
                    ))}
                    <option value="auto_default">+ Auto-create new service account</option>
                  </>
                ) : (
                  <option value="auto_default">
                    ✨ Default Workspace Service Account (Auto-create)
                  </option>
                )}
              </select>
              {serviceAccounts.length === 0 && (
                <p className="mt-1.5 text-[11px] text-slate-400 leading-relaxed">
                  No service accounts registered yet in this workspace. A default service account will be automatically created for this API key.
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Permission Scopes
              </label>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {AVAILABLE_SCOPES.map((scope) => (
                  <label
                    key={scope.id}
                    className="flex items-start gap-2.5 p-2.5 rounded-lg border border-slate-800 bg-slate-950 hover:bg-slate-850 cursor-pointer transition min-h-[44px]"
                  >
                    <input
                      type="checkbox"
                      checked={selectedScopes.includes(scope.id)}
                      onChange={() => toggleScope(scope.id)}
                      className="mt-0.5 rounded border-slate-700 bg-slate-900 text-violet-600 focus:ring-violet-500 h-4 w-4"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-mono font-medium text-violet-300">
                        {scope.label}
                      </div>
                      <div className="text-[11px] text-slate-400">{scope.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 transition min-h-[44px]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !name.trim()}
                className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-lg shadow-violet-600/20 transition disabled:opacity-50 min-h-[44px]"
              >
                {submitting ? 'Generating...' : 'Generate API Key'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
