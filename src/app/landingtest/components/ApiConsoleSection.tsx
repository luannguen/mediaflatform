'use client';

import React, { useState } from 'react';
import { Terminal, Play, Copy, Check, Clock, Server, ArrowRight } from 'lucide-react';
import { DEMO_CREDENTIALS } from './HeroSection';
import { toast } from 'sonner';

interface Preset {
  id: string;
  name: string;
  method: 'GET' | 'POST';
  path: string;
  body?: string;
  description: string;
}

const PRESETS: Preset[] = [
  {
    id: 'sparse-fields',
    name: '1. Sparse Fieldsets (Lọc trường nhẹ)',
    method: 'GET',
    path: '/api/v1/assets?limit=3&fields=id,display_name,mime_type,storage_url',
    description: 'Chỉ trả về các trường cần thiết, giảm 80% dung lượng JSON payload',
  },
  {
    id: 'batch-resolve',
    name: '2. Batch Resolving (Chống N+1 Query)',
    method: 'POST',
    path: '/api/v1/assets/batch',
    body: JSON.stringify(
      {
        ids: ['med_demo_nike_sneaker', 'med_demo_smartwatch', 'med_demo_modern_villa'],
        transform: { width: 600, format: 'webp', quality: 80 },
      },
      null,
      2
    ),
    description: 'Phân giải hàng loạt ID media kèm delivery_url chỉ trong 1 câu truy vấn',
  },
  {
    id: 'cursor-pagination',
    name: '3. Cursor-based Pagination (Hiệu năng cao)',
    method: 'GET',
    path: '/api/v1/assets?cursor=med_demo_nike_sneaker&limit=2',
    description: 'Phân trang bằng cursor ID, tránh trùng lặp dữ liệu khi có upload mới',
  },
  {
    id: 'unlimited-safe',
    name: '4. Safe Ceiling Unlimited (?limit=all)',
    method: 'GET',
    path: '/api/v1/assets?limit=all',
    description: 'Lấy toàn bộ media an toàn với trần tối đa 1.000 items chống sập RAM',
  },
];

export function ApiConsoleSection() {
  const [selectedPreset, setSelectedPreset] = useState<Preset>(PRESETS[0]);
  const [customPath, setCustomPath] = useState(PRESETS[0].path);
  const [customBody, setCustomBody] = useState(PRESETS[0].body || '');
  const [loading, setLoading] = useState(false);
  const [responseStatus, setResponseStatus] = useState<number | null>(null);
  const [responseHeaders, setResponseHeaders] = useState<Record<string, string>>({});
  const [responseData, setResponseData] = useState<any | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [copiedResponse, setCopiedResponse] = useState(false);

  const handleSelectPreset = (preset: Preset) => {
    setSelectedPreset(preset);
    setCustomPath(preset.path);
    setCustomBody(preset.body || '');
    setResponseData(null);
    setResponseStatus(null);
  };

  const handleSendRequest = async () => {
    setLoading(true);
    setResponseData(null);
    setResponseStatus(null);
    setLatencyMs(null);

    const startTime = performance.now();
    try {
      const options: RequestInit = {
        method: selectedPreset.method,
        headers: {
          'Content-Type': 'application/json',
          'X-Media-Api-Version': '2026-09-01',
        },
      };

      if (selectedPreset.method === 'POST' && customBody.trim()) {
        options.body = customBody;
      }

      let res = await fetch(customPath, options);
      if (res.status === 401) {
        await fetch('/api/v1/demo/session', { method: 'POST' });
        res = await fetch(customPath, options);
      }
      const elapsed = Math.round(performance.now() - startTime);
      setLatencyMs(elapsed);
      setResponseStatus(res.status);

      // Collect key headers
      const headersObj: Record<string, string> = {};
      const keyHeaderNames = ['x-total-count', 'x-has-more', 'x-page', 'x-limit', 'content-type', 'etag', 'cache-control'];
      keyHeaderNames.forEach((h) => {
        const val = res.headers.get(h);
        if (val) headersObj[h] = val;
      });
      setResponseHeaders(headersObj);

      const json = await res.json();
      setResponseData(json);
      toast.success(`Yêu cầu API hoàn tất trong ${elapsed}ms (${res.status})`);
    } catch (err: any) {
      const elapsed = Math.round(performance.now() - startTime);
      setLatencyMs(elapsed);
      setResponseStatus(500);
      setResponseData({ error: err.message || 'Lỗi gửi yêu cầu API' });
      toast.error('Lỗi khi gửi yêu cầu API');
    } finally {
      setLoading(false);
    }
  };

  const copyResponseJson = () => {
    if (!responseData) return;
    navigator.clipboard.writeText(JSON.stringify(responseData, null, 2));
    setCopiedResponse(true);
    toast.success('Đã sao chép phản hồi JSON!');
    setTimeout(() => setCopiedResponse(false), 2000);
  };

  return (
    <section id="api-console" className="py-20 border-b border-slate-800/80 bg-slate-900/40 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 text-xs font-semibold px-2.5 py-1 rounded-md bg-sky-500/10 text-sky-400 border border-sky-500/20 mb-3">
            <Terminal className="w-3.5 h-3.5" />
            <span>Interactive REST API Sandbox</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            API Playground Trực Tiếp (Live Console)
          </h2>
          <p className="mt-3 text-sm sm:text-base text-slate-400">
            Thử nghiệm trực tiếp các tính năng cao cấp của Media Platform: Sparse Fieldsets, Batch Resolving, 
            Cursor Pagination và Headers phân trang chuẩn HTTP.
          </p>
        </div>

        {/* Preset Selector Tabs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {PRESETS.map((preset) => {
            const isSelected = selectedPreset.id === preset.id;
            return (
              <button
                key={preset.id}
                onClick={() => handleSelectPreset(preset)}
                className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-sky-500/15 border-sky-500/50 shadow-lg shadow-sky-500/10'
                    : 'bg-slate-950/70 border-slate-800/80 hover:bg-slate-900 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span
                    className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                      preset.method === 'POST' ? 'bg-purple-500/20 text-purple-300' : 'bg-sky-500/20 text-sky-300'
                    }`}
                  >
                    {preset.method}
                  </span>
                  {isSelected && <span className="w-2 h-2 rounded-full bg-sky-400" />}
                </div>
                <div className="font-semibold text-xs text-slate-200 line-clamp-1">{preset.name}</div>
                <div className="text-[11px] text-slate-500 mt-1 line-clamp-1">{preset.description}</div>
              </button>
            );
          })}
        </div>

        {/* Console Workspace Box */}
        <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
          {/* URL & Method Input Bar */}
          <div className="p-4 border-b border-slate-800 bg-slate-900/60 flex flex-col sm:flex-row items-center gap-3">
            <span
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold uppercase shrink-0 ${
                selectedPreset.method === 'POST'
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                  : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
              }`}
            >
              {selectedPreset.method}
            </span>

            <div className="flex-1 w-full relative">
              <input
                type="text"
                value={customPath}
                onChange={(e) => setCustomPath(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-sky-500"
              />
            </div>

            <button
              onClick={handleSendRequest}
              disabled={loading}
              className="w-full sm:w-auto px-5 py-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-sky-500/25 transition-all disabled:opacity-50"
            >
              <Play className={`w-3.5 h-3.5 fill-current ${loading ? 'animate-pulse' : ''}`} />
              <span>{loading ? 'Sending...' : 'Send Live Request'}</span>
            </button>
          </div>

          {/* Request Headers Strip */}
          <div className="px-4 py-2 bg-slate-950/80 border-b border-slate-800/60 flex flex-wrap items-center gap-4 text-[11px] font-mono text-slate-400">
            <div>
              <span className="text-slate-600">X-Media-Api-Key:</span>{' '}
              <span className="text-sky-400">{DEMO_CREDENTIALS.keyPrefix}_***</span>
            </div>
            <div>
              <span className="text-slate-600">X-Media-Api-Version:</span>{' '}
              <span className="text-purple-400">2026-09-01</span>
            </div>
            {selectedPreset.method === 'POST' && (
              <div>
                <span className="text-slate-600">Content-Type:</span>{' '}
                <span className="text-emerald-400">application/json</span>
              </div>
            )}
          </div>

          {/* Body Editor (If POST) */}
          {selectedPreset.method === 'POST' && (
            <div className="p-4 border-b border-slate-800 bg-slate-950">
              <span className="text-xs font-mono text-slate-500 block mb-2">REQUEST BODY (JSON):</span>
              <textarea
                value={customBody}
                onChange={(e) => setCustomBody(e.target.value)}
                rows={4}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs font-mono text-emerald-400 focus:outline-none focus:border-sky-500"
              />
            </div>
          )}

          {/* Response Output Area */}
          <div className="p-5">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800/80">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-slate-300">RESPONSE VIEWER:</span>
                {responseStatus && (
                  <span
                    className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                      responseStatus >= 200 && responseStatus < 300
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-red-500/20 text-red-400 border border-red-500/30'
                    }`}
                  >
                    HTTP {responseStatus}
                  </span>
                )}
                {latencyMs !== null && (
                  <span className="text-xs font-mono text-slate-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {latencyMs} ms
                  </span>
                )}
              </div>

              {responseData && (
                <button
                  onClick={copyResponseJson}
                  className="flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 cursor-pointer"
                >
                  {copiedResponse ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedResponse ? 'Đã sao chép' : 'Copy JSON'}</span>
                </button>
              )}
            </div>

            {/* Key HTTP Response Headers */}
            {Object.keys(responseHeaders).length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2 text-[11px] font-mono">
                {Object.entries(responseHeaders).map(([key, val]) => (
                  <span key={key} className="px-2 py-1 rounded bg-slate-900 text-slate-300 border border-slate-800">
                    <strong className="text-sky-400">{key}:</strong> {val}
                  </span>
                ))}
              </div>
            )}

            {/* JSON Code Viewer */}
            <div className="relative rounded-xl overflow-hidden bg-slate-900/90 border border-slate-800/80 p-4 max-h-96 overflow-y-auto font-mono text-xs text-slate-300 leading-relaxed">
              {loading ? (
                <div className="py-12 text-center text-slate-500">
                  <div className="w-6 h-6 border-2 border-sky-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  Đang thực thi yêu cầu API...
                </div>
              ) : responseData ? (
                <pre className="text-emerald-400 whitespace-pre-wrap">{JSON.stringify(responseData, null, 2)}</pre>
              ) : (
                <div className="py-12 text-center text-slate-600">
                  Nhấn <span className="text-sky-400 font-semibold">&quot;Send Live Request&quot;</span> ở trên để xem phản hồi JSON từ server thực tế.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
