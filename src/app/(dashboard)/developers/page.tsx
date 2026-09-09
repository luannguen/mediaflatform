'use client';

import { useState } from 'react';
import { useDeveloper } from '@/hooks/useDeveloper';
import { ApiKeyModal } from '@/components/developer/ApiKeyModal';
import { IntegrationGuide } from '@/components/developer/IntegrationGuide';
import { WebhookManager } from '@/components/developer/WebhookManager';
import { KeyRound, Plus, Trash2, Globe, Code2, Webhook, Key } from 'lucide-react';
import { toast } from 'sonner';

export default function DevelopersPage() {
  const { apiKeys, applications, serviceAccounts, loading, createApiKey, revokeApiKey, createApplication } =
    useDeveloper();
  const [modalOpen, setModalOpen] = useState(false);
  const [newAppName, setNewAppName] = useState('');
  const [creatingApp, setCreatingApp] = useState(false);
  const [activeTab, setActiveTab] = useState<'guide' | 'keys' | 'webhooks'>('guide');

  const handleCreateApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAppName.trim()) return;
    setCreatingApp(true);
    await createApplication(newAppName.trim());
    setNewAppName('');
    setCreatingApp(false);
  };

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight">Developer Hub & Headless API</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Centralized SDK, cryptographic API tokens, dynamic image transformations, and real-time webhooks
          </p>
        </div>
        {activeTab === 'keys' && (
          <button
            onClick={() => setModalOpen(true)}
            className="min-h-[44px] flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition shadow-lg shadow-violet-600/20"
          >
            <Plus className="h-4 w-4" />
            <span>Generate API Key</span>
          </button>
        )}
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 p-1 rounded-xl bg-slate-900 border border-slate-800">
        <button
          onClick={() => setActiveTab('guide')}
          className={`min-h-[44px] flex-1 flex items-center justify-center gap-2 rounded-lg text-xs font-semibold transition ${
            activeTab === 'guide'
              ? 'bg-violet-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
          }`}
        >
          <Code2 className="h-4 w-4" />
          <span>SDK & Code Generator</span>
        </button>

        <button
          onClick={() => setActiveTab('keys')}
          className={`min-h-[44px] flex-1 flex items-center justify-center gap-2 rounded-lg text-xs font-semibold transition ${
            activeTab === 'keys'
              ? 'bg-violet-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
          }`}
        >
          <Key className="h-4 w-4" />
          <span>API Keys & Apps</span>
          {apiKeys.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-950/60 text-slate-300">
              {apiKeys.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('webhooks')}
          className={`min-h-[44px] flex-1 flex items-center justify-center gap-2 rounded-lg text-xs font-semibold transition ${
            activeTab === 'webhooks'
              ? 'bg-violet-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
          }`}
        >
          <Webhook className="h-4 w-4" />
          <span>Webhooks (Outbound)</span>
        </button>
      </div>

      {/* Tab: SDK & Code Generator */}
      {activeTab === 'guide' && (
        <IntegrationGuide apiKeys={apiKeys} />
      )}

      {/* Tab: Webhooks */}
      {activeTab === 'webhooks' && (
        <WebhookManager />
      )}

      {/* Tab: Keys & Apps */}
      {activeTab === 'keys' && (
        <>

      {/* Applications Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
            Connected Applications
          </h2>
        </div>

        {/* Register New App Inline */}
        <form
          onSubmit={handleCreateApp}
          className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center gap-3"
        >
          <Globe className="h-5 w-5 text-violet-400 flex-shrink-0" />
          <input
            type="text"
            placeholder="Register new external application (e.g. Commerce Platform, Community App)..."
            value={newAppName}
            onChange={(e) => setNewAppName(e.target.value)}
            className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-violet-500"
          />
          <button
            type="submit"
            disabled={creatingApp || !newAppName.trim()}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 transition disabled:opacity-50"
          >
            {creatingApp ? 'Registering...' : 'Register App'}
          </button>
        </form>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {applications.map((app) => (
            <div key={app.id} className="p-4 rounded-xl bg-slate-900 border border-slate-800">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">{app.name}</h3>
                  <span className="text-xs font-mono text-slate-400 block mt-0.5">{app.id}</span>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  {app.environment}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                {app.description || 'General headless API client integration'}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* API Keys Table */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
          Issued API Keys
        </h2>

        {loading ? (
          <div className="h-32 bg-slate-900 rounded-xl animate-pulse" />
        ) : apiKeys.length > 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-4">Key Label</th>
                    <th className="py-3 px-4">Prefix</th>
                    <th className="py-3 px-4">Scopes</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Created</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {apiKeys.map((k) => (
                    <tr key={k.id} className="hover:bg-slate-850/50">
                      <td className="py-3 px-4 font-medium text-slate-200">{k.name}</td>
                      <td className="py-3 px-4 font-mono text-violet-400">{k.key_prefix}••••••••</td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {k.scopes.map((s) => (
                            <span
                              key={s}
                              className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300"
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            k.status === 'active'
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : 'bg-rose-500/10 text-rose-400'
                          }`}
                        >
                          {k.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-400">
                        {new Date(k.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {k.status === 'active' && (
                          <button
                            onClick={() => revokeApiKey(k.id)}
                            className="p-1 rounded text-rose-400 hover:bg-rose-950/50 transition"
                            title="Revoke Key"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="p-12 text-center bg-slate-900/40 border border-slate-800 rounded-2xl">
            <KeyRound className="h-10 w-10 text-slate-400 mx-auto mb-2" />
            <h3 className="text-sm font-medium text-slate-200">No API Keys Generated</h3>
            <p className="text-xs text-slate-400 mt-1">
              Click &quot;Generate API Key&quot; above to create a secret token for your external apps.
            </p>
          </div>
        )}
      </div>
      </>
      )}

      <ApiKeyModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        serviceAccounts={serviceAccounts}
        onCreateKey={createApiKey}
      />
    </div>
  );
}
