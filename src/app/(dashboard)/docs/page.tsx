'use client';

import { useState } from 'react';
import { API_SPECIFICATION, ApiEndpointSpec } from '@/lib/docs/api-spec';
import { UserGuideSection } from '@/components/docs/UserGuideSection';
import { ApiVersionSection } from '@/components/docs/ApiVersionSection';
import { PerformanceGuideSection } from '@/components/docs/PerformanceGuideSection';
import { ArchitectureRoadmapSection } from '@/components/docs/ArchitectureRoadmapSection';
import {
  BookOpen,
  Code2,
  GitBranch,
  Zap,
  Rocket,
  Search,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';

export default function ApiDocsPage() {
  const [activeTab, setActiveTab] = useState<'guide' | 'api' | 'versions' | 'performance' | 'roadmap'>('guide');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [expandedEndpoints, setExpandedEndpoints] = useState<Record<string, boolean>>({
    'list-assets': true,
    'batch-assets': true,
  });
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success('Code copied to clipboard');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleEndpoint = (id: string) => {
    setExpandedEndpoints((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const filteredEndpoints = API_SPECIFICATION.filter((ep) => {
    const matchesCat = selectedCategory === 'all' || ep.category.toLowerCase() === selectedCategory.toLowerCase();
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !searchQuery ||
      ep.title.toLowerCase().includes(q) ||
      ep.path.toLowerCase().includes(q) ||
      ep.description.toLowerCase().includes(q);
    return matchesCat && matchesSearch;
  });

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
            <span>Knowledge Hub & Developer Center</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-violet-500/10 text-violet-400 border border-violet-500/20">
              API v1.0 LTS
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Cẩm nang quản trị người dùng, tài liệu đặc tả API v1, kỹ thuật tối ưu hiệu năng và lộ trình công nghệ
          </p>
        </div>
      </div>

      {/* 5-Tab Navigation Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 p-1.5 rounded-2xl bg-slate-900 border border-slate-800">
        <button
          onClick={() => setActiveTab('guide')}
          className={`min-h-[44px] flex items-center justify-center gap-2 rounded-xl text-xs font-semibold transition px-3 ${
            activeTab === 'guide'
              ? 'bg-violet-600 text-white shadow-lg shadow-violet-600/25'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
          }`}
        >
          <BookOpen className="h-4 w-4" />
          <span>1. User Guide</span>
        </button>

        <button
          onClick={() => setActiveTab('api')}
          className={`min-h-[44px] flex items-center justify-center gap-2 rounded-xl text-xs font-semibold transition px-3 ${
            activeTab === 'api'
              ? 'bg-violet-600 text-white shadow-lg shadow-violet-600/25'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
          }`}
        >
          <Code2 className="h-4 w-4" />
          <span>2. API v1 Docs</span>
        </button>

        <button
          onClick={() => setActiveTab('versions')}
          className={`min-h-[44px] flex items-center justify-center gap-2 rounded-xl text-xs font-semibold transition px-3 ${
            activeTab === 'versions'
              ? 'bg-violet-600 text-white shadow-lg shadow-violet-600/25'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
          }`}
        >
          <GitBranch className="h-4 w-4" />
          <span>3. Versioning</span>
        </button>

        <button
          onClick={() => setActiveTab('performance')}
          className={`min-h-[44px] flex items-center justify-center gap-2 rounded-xl text-xs font-semibold transition px-3 ${
            activeTab === 'performance'
              ? 'bg-violet-600 text-white shadow-lg shadow-violet-600/25'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
          }`}
        >
          <Zap className="h-4 w-4" />
          <span>4. Performance</span>
        </button>

        <button
          onClick={() => setActiveTab('roadmap')}
          className={`col-span-2 sm:col-span-1 min-h-[44px] flex items-center justify-center gap-2 rounded-xl text-xs font-semibold transition px-3 ${
            activeTab === 'roadmap'
              ? 'bg-violet-600 text-white shadow-lg shadow-violet-600/25'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
          }`}
        >
          <Rocket className="h-4 w-4" />
          <span>5. Roadmap</span>
        </button>
      </div>

      {/* Tab 1: User Guide */}
      {activeTab === 'guide' && <UserGuideSection />}

      {/* Tab 3: API Versioning */}
      {activeTab === 'versions' && <ApiVersionSection />}

      {/* Tab 4: Performance */}
      {activeTab === 'performance' && <PerformanceGuideSection />}

      {/* Tab 5: Architecture Roadmap */}
      {activeTab === 'roadmap' && <ArchitectureRoadmapSection />}

      {/* Tab 2: API v1 Reference & Explorer */}
      {activeTab === 'api' && (
        <div className="space-y-6">
          {/* Filter Toolbar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 rounded-2xl bg-slate-900 border border-slate-800">
            <div className="relative flex-1">
              <Search className="h-4 w-4 absolute left-3 top-3 text-slate-500" />
              <input
                type="text"
                placeholder="Search endpoints, methods, parameters..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-violet-500 min-h-[40px]"
              />
            </div>

            {/* Category Pills */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
              {['all', 'assets', 'uploads', 'delivery', 'references', 'webhooks'].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold uppercase tracking-wider transition whitespace-nowrap ${
                    selectedCategory === cat
                      ? 'bg-violet-600/20 text-violet-400 border border-violet-500/40'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-850'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Endpoints Accordion List */}
          <div className="space-y-4">
            {filteredEndpoints.map((ep) => {
              const isExpanded = !!expandedEndpoints[ep.id];
              const methodBadgeClass =
                ep.method === 'GET'
                  ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                  : ep.method === 'POST'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : ep.method === 'DELETE'
                  ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20';

              return (
                <div
                  key={ep.id}
                  className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden transition-all shadow-md"
                >
                  {/* Endpoint Header Bar */}
                  <div
                    onClick={() => toggleEndpoint(ep.id)}
                    className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-850/50 transition select-none"
                  >
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold uppercase border ${methodBadgeClass}`}>
                        {ep.method}
                      </span>
                      <code className="text-sm font-semibold text-slate-100 font-mono">{ep.path}</code>
                      <span className="text-xs text-slate-400 hidden sm:inline">•</span>
                      <span className="text-xs text-slate-300 font-medium">{ep.title}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-400">
                        {ep.scopeRequired}
                      </span>
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-slate-400" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-slate-400" />
                      )}
                    </div>
                  </div>

                  {/* Endpoint Details Drawer */}
                  {isExpanded && (
                    <div className="p-5 pt-1 border-t border-slate-800/80 space-y-5 bg-slate-950/40">
                      <p className="text-xs text-slate-300 leading-relaxed">{ep.description}</p>

                      {/* Parameters Table */}
                      {ep.parameters && ep.parameters.length > 0 && (
                        <div className="space-y-2">
                          <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                            Query / Header Parameters
                          </h4>
                          <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-slate-950/80 text-slate-400 font-semibold uppercase text-[10px]">
                                <tr>
                                  <th className="py-2.5 px-3">Field</th>
                                  <th className="py-2.5 px-3">Type / In</th>
                                  <th className="py-2.5 px-3">Required</th>
                                  <th className="py-2.5 px-3">Description</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                                {ep.parameters.map((p) => (
                                  <tr key={p.name}>
                                    <td className="py-2 px-3 text-violet-400 font-semibold">{p.name}</td>
                                    <td className="py-2 px-3 text-slate-400">
                                      {p.type} <span className="text-slate-500">({p.in})</span>
                                    </td>
                                    <td className="py-2 px-3">
                                      {p.required ? (
                                        <span className="text-rose-400 text-[10px] font-bold">YES</span>
                                      ) : (
                                        <span className="text-slate-500 text-[10px]">optional</span>
                                      )}
                                    </td>
                                    <td className="py-2 px-3 text-slate-300 font-sans">{p.description}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Request Body Example */}
                      {ep.requestBody && (
                        <div className="space-y-2">
                          <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                            Request Body ({ep.requestBody.contentType})
                          </h4>
                          <pre className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-300 font-mono overflow-x-auto">
                            {ep.requestBody.example}
                          </pre>
                        </div>
                      )}

                      {/* Response Example */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                            Response ({ep.responses[0]?.status} {ep.responses[0]?.description})
                          </h4>
                        </div>
                        <pre className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-emerald-400 font-mono overflow-x-auto max-h-64">
                          {ep.responses[0]?.example}
                        </pre>
                      </div>

                      {/* Code Snippets (cURL & SDK) */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                        {/* cURL */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
                            <span>cURL Request:</span>
                            <button
                              onClick={() => copyText(ep.curlExample, `${ep.id}-curl`)}
                              className="text-[11px] text-violet-400 hover:text-violet-300 flex items-center gap-1"
                            >
                              {copiedId === `${ep.id}-curl` ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                              <span>Copy</span>
                            </button>
                          </div>
                          <pre className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-300 font-mono overflow-x-auto">
                            {ep.curlExample}
                          </pre>
                        </div>

                        {/* SDK */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
                            <span>Client SDK Method:</span>
                            <button
                              onClick={() => copyText(ep.sdkExample, `${ep.id}-sdk`)}
                              className="text-[11px] text-violet-400 hover:text-violet-300 flex items-center gap-1"
                            >
                              {copiedId === `${ep.id}-sdk` ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                              <span>Copy</span>
                            </button>
                          </div>
                          <pre className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-violet-300 font-mono overflow-x-auto">
                            {ep.sdkExample}
                          </pre>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
