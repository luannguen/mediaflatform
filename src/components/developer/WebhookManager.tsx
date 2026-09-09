'use client';

import { useState, useEffect, useCallback } from 'react';
import { WebhookEndpoint, WebhookDelivery } from '@/types/database';
import { Webhook, Plus, Check, Copy, AlertCircle, RefreshCw, Radio, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

const EVENT_OPTIONS = [
  { id: 'asset.created', label: 'asset.created', desc: 'Triggered when a new asset is uploaded & registered' },
  { id: 'asset.trashed', label: 'asset.trashed', desc: 'Triggered when an asset is moved to trash' },
  { id: 'asset.restored', label: 'asset.restored', desc: 'Triggered when an asset is restored from trash' },
  { id: 'asset.deleted', label: 'asset.deleted', desc: 'Triggered when an asset is permanently purged' },
  { id: '*', label: '* (All Events)', desc: 'Receive all system notifications and asset lifecycle events' },
];

export function WebhookManager() {
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>(['asset.created', 'asset.deleted']);
  const [creating, setCreating] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [epRes, delRes] = await Promise.all([
        fetch('/api/v1/webhooks'),
        fetch('/api/v1/webhooks/deliveries'),
      ]);

      if (epRes.ok) {
        const epJson = await epRes.json();
        setEndpoints(epJson.data || []);
      }
      if (delRes.ok) {
        const delJson = await delRes.json();
        setDeliveries(delJson.data || []);
      }
    } catch {
      toast.error('Failed to load webhook configuration');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !url.trim()) {
      toast.error('Name and valid URL are required');
      return;
    }

    setCreating(true);
    try {
      const res = await fetch('/api/v1/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          url: url.trim(),
          events: selectedEvents.length > 0 ? selectedEvents : ['asset.created'],
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || 'Failed to create webhook');

      setCreatedSecret(json.data.signing_secret);
      setEndpoints((prev) => [json.data.endpoint, ...prev]);
      toast.success('Webhook endpoint registered');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  };

  const copySecret = () => {
    if (!createdSecret) return;
    navigator.clipboard.writeText(createdSecret);
    setCopied(true);
    toast.success('Webhook signing secret copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-2">
            <Webhook className="h-4 w-4 text-emerald-400" />
            Outbound Webhooks (Event Dispatching)
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time HTTP POST notifications signed with HMAC-SHA256 for external services
          </p>
        </div>
        <button
          onClick={() => {
            setCreatedSecret(null);
            setName('');
            setUrl('');
            setModalOpen(true);
          }}
          className="min-h-[44px] flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition shadow-lg shadow-emerald-600/20"
        >
          <Plus className="h-4 w-4" />
          <span>Add Webhook Endpoint</span>
        </button>
      </div>

      {loading ? (
        <div className="h-28 bg-slate-900 rounded-xl animate-pulse" />
      ) : endpoints.length === 0 ? (
        <div className="p-8 text-center bg-slate-900/40 border border-slate-800 rounded-2xl">
          <Radio className="h-8 w-8 text-slate-500 mx-auto mb-2" />
          <h3 className="text-xs font-semibold text-slate-300">No Webhook Endpoints Registered</h3>
          <p className="text-[11px] text-slate-400 mt-1 max-w-sm mx-auto">
            Connect your backend (e-commerce, CRM, mobile API) to receive instant notifications when assets are created or modified.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {endpoints.map((ep) => (
            <div key={ep.id} className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                    {ep.name}
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      {ep.status}
                    </span>
                  </h3>
                  <div className="text-xs font-mono text-slate-400 break-all mt-1 bg-slate-950 p-1.5 rounded border border-slate-800/80">
                    {ep.url}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-1 items-center">
                <span className="text-[11px] text-slate-400 mr-1">Subscribed:</span>
                {ep.events.map((evt) => (
                  <span
                    key={evt}
                    className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700/60"
                  >
                    {evt}
                  </span>
                ))}
              </div>

              <div className="text-[10px] text-slate-400 pt-1 border-t border-slate-800 flex items-center justify-between">
                <span>ID: <code className="text-slate-400">{ep.id}</code></span>
                <span>Security: <strong className="text-emerald-400 font-semibold">HMAC-SHA256</strong></span>
              </div>
            </div>
          ))}
        </div>
      )}

      {deliveries.length > 0 && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <RefreshCw className="h-3.5 w-3.5 text-slate-400" />
              Recent Webhook Deliveries Log
            </h3>
            <button
              onClick={fetchData}
              className="text-[11px] text-violet-400 hover:text-violet-300 transition"
            >
              Refresh Logs
            </button>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="py-2.5 px-4">Event ID</th>
                    <th className="py-2.5 px-4">Event Type</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4">Response</th>
                    <th className="py-2.5 px-4 text-right">Dispatched</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                  {deliveries.slice(0, 10).map((d) => (
                    <tr key={d.id} className="hover:bg-slate-850/50">
                      <td className="py-2.5 px-4 text-slate-300">{d.event_id}</td>
                      <td className="py-2.5 px-4 text-violet-400">{d.event_type}</td>
                      <td className="py-2.5 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            d.status === 'delivered'
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : 'bg-rose-500/10 text-rose-400'
                          }`}
                        >
                          {d.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-slate-400">{d.response_summary || '-'}</td>
                      <td className="py-2.5 px-4 text-right text-slate-400">
                        {new Date(d.created_at).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-5 shadow-2xl">
            {!createdSecret ? (
              <form onSubmit={handleCreateWebhook} className="space-y-4">
                <div>
                  <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                    <Webhook className="h-5 w-5 text-emerald-400" />
                    Register Webhook Endpoint
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Receive real-time notifications whenever media changes in this workspace.
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Webhook Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Production Shopify Sync"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500 min-h-[44px]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Payload URL (HTTPS/HTTP)</label>
                  <input
                    type="url"
                    required
                    placeholder="https://api.my-domain.com/webhooks/media"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500 min-h-[44px] font-mono"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-300">Subscribed Events</label>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {EVENT_OPTIONS.map((opt) => {
                      const checked = selectedEvents.includes(opt.id);
                      return (
                        <div
                          key={opt.id}
                          onClick={() => {
                            if (checked) {
                              setSelectedEvents(selectedEvents.filter((e) => e !== opt.id));
                            } else {
                              setSelectedEvents([...selectedEvents, opt.id]);
                            }
                          }}
                          className={`p-2 rounded-lg border cursor-pointer transition flex items-start gap-2.5 min-h-[44px] ${
                            checked
                              ? 'bg-emerald-950/30 border-emerald-500/50'
                              : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-750'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            readOnly
                            className="mt-0.5 rounded text-emerald-500 focus:ring-0"
                          />
                          <div>
                            <div className="text-xs font-mono font-semibold text-slate-200">{opt.label}</div>
                            <div className="text-[11px] text-slate-400">{opt.desc}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="min-h-[44px] px-4 py-2 rounded-lg border border-slate-750 text-slate-300 hover:bg-slate-800 text-xs font-medium transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creating}
                    className="min-h-[44px] px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition disabled:opacity-50"
                  >
                    {creating ? 'Registering...' : 'Register Webhook'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-emerald-400">
                  <ShieldCheck className="h-6 w-6" />
                  <h3 className="text-base font-bold text-slate-100">Webhook Secret Generated</h3>
                </div>

                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-start gap-2.5">
                  <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                  <div>
                    <strong>Store this secret safely!</strong> Use it in your backend server to verify the
                    <code className="bg-amber-950/50 px-1 py-0.5 mx-1 rounded">X-Media-Signature</code>
                    header sent with every webhook payload using HMAC-SHA256.
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">Signing Secret</label>
                  <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-emerald-400 break-all">
                    <span className="flex-1">{createdSecret}</span>
                    <button
                      onClick={copySecret}
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
                      title="Copy Secret"
                    >
                      {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex justify-end pt-3">
                  <button
                    onClick={() => setModalOpen(false)}
                    className="min-h-[44px] px-6 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold transition"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
