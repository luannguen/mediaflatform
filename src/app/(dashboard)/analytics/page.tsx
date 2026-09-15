'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  BarChart3,
  TrendingUp,
  Cpu,
  HardDrive,
  Zap,
  Eye,
  Download,
  ShieldCheck,
  RefreshCw,
  Layers,
  Sparkles,
  CheckCircle2,
  Clock,
  ArrowUpRight,
} from 'lucide-react';

interface AnalyticsData {
  workspaceId: string;
  period: string;
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number;
  totalBytesTransferred: number;
  totalBytesSaved: number;
  bandwidthSavedPercent: number;
  avgLatencyMs: number;
  formatBreakdown: {
    format: string;
    count: number;
    bytes: number;
  }[];
  topAssets: {
    assetId: string;
    displayName: string;
    mimeType: string;
    requestsCount: number;
    bytesTransferred: number;
    storageUrl?: string | null;
  }[];
  recentEvents: {
    id: string;
    assetId?: string | null;
    eventType: string;
    bytesTransferred: number;
    bytesSaved: number;
    format?: string | null;
    latencyMs: number;
    createdAt: string;
  }[];
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export default function AnalyticsDashboardPage() {
  const [period, setPeriod] = useState<'24h' | '7d' | '30d'>('24h');
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAnalytics = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const res = await fetch(`/api/v1/analytics?period=${period}`);
      const json = await res.json();
      if (json.data) {
        setData(json.data);
      }
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [period]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
      {/* Header & Filter Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-violet-400">
              <BarChart3 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">
                Phân Tích Băng Thông & CDN Observability
              </h1>
              <p className="text-sm text-slate-400">
                Theo dõi hiệu năng chuyển đổi Sharp, tỷ lệ Cache Hit 304, và lưu lượng tiết kiệm theo thời gian thực
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Period selector */}
          <div className="bg-slate-900 border border-slate-800 p-1 rounded-xl flex items-center gap-1">
            {(['24h', '7d', '30d'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  period === p
                    ? 'bg-violet-600 text-white shadow-md shadow-violet-600/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                {p === '24h' ? '24 Giờ' : p === '7d' ? '7 Ngày' : '30 Ngày'}
              </button>
            ))}
          </div>

          <button
            onClick={() => fetchAnalytics(true)}
            disabled={refreshing}
            className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-all"
            title="Làm mới dữ liệu"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin text-violet-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* 4 Core KPI Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Card 1: Total Requests */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 hover:border-slate-700/80 transition-all backdrop-blur-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">
            <span>Tổng Lượt Requests</span>
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
              <Activity className="h-4 w-4" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-white tracking-tight mb-2">
            {loading ? '...' : (data?.totalRequests || 0).toLocaleString()}
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="text-emerald-400 font-semibold">{data?.cacheHits || 0} hits</span>
            <span>•</span>
            <span className="text-slate-400">{data?.cacheMisses || 0} transforms</span>
          </div>
        </div>

        {/* Card 2: Cache Hit Rate */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 hover:border-slate-700/80 transition-all backdrop-blur-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">
            <span>Tỷ Lệ Cache Hit Rate</span>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
              <Zap className="h-4 w-4" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-emerald-400 tracking-tight mb-2">
            {loading ? '...' : `${data?.cacheHitRate || 0}%`}
          </div>
          <div className="text-xs text-slate-400 flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            <span>Phản hồi HTTP 304 Not Modified</span>
          </div>
        </div>

        {/* Card 3: Bandwidth Saved */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 hover:border-slate-700/80 transition-all backdrop-blur-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">
            <span>Băng Thông Tiết Kiệm</span>
            <div className="p-2 rounded-lg bg-violet-500/10 text-violet-400">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-violet-400 tracking-tight mb-2">
            {loading ? '...' : `${data?.bandwidthSavedPercent || 0}%`}
          </div>
          <div className="text-xs text-slate-400">
            Đã giảm{' '}
            <span className="text-white font-semibold">{formatBytes(data?.totalBytesSaved || 0)}</span>{' '}
            so với gốc
          </div>
        </div>

        {/* Card 4: Average Latency */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 hover:border-slate-700/80 transition-all backdrop-blur-sm">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">
            <span>Độ Trễ Trung Bình</span>
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
              <Cpu className="h-4 w-4" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-white tracking-tight mb-2">
            {loading ? '...' : `${data?.avgLatencyMs || 0} ms`}
          </div>
          <div className="text-xs text-slate-400">
            Pipeline Sharp C++ Node.js Engine
          </div>
        </div>
      </div>

      {/* Main Content Layout: Breakdown & Top Assets vs Live Stream */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left 2 Cols: Format Distribution & Top Assets Table */}
        <div className="lg:col-span-2 space-y-8">
          {/* Format Breakdown Card */}
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 backdrop-blur-sm">
            <h2 className="text-base font-bold text-white mb-1 flex items-center gap-2">
              <Layers className="h-4 w-4 text-violet-400" />
              Phân Bổ Lưu Lượng Theo Định Dạng
            </h2>
            <p className="text-xs text-slate-400 mb-6">
              Các định dạng hình ảnh WebP và AVIF tự động nén tối ưu băng thông khi phân phối
            </p>

            <div className="space-y-4">
              {data?.formatBreakdown.map((item) => {
                const percent =
                  data.totalRequests > 0
                    ? Math.round((item.count / data.totalRequests) * 100)
                    : 0;

                const colorMap: Record<string, string> = {
                  webp: 'bg-emerald-500',
                  avif: 'bg-violet-500',
                  jpeg: 'bg-amber-500',
                  jpg: 'bg-amber-500',
                  png: 'bg-blue-500',
                };
                const barColor = colorMap[item.format.toLowerCase()] || 'bg-slate-500';

                return (
                  <div key={item.format} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-200 uppercase tracking-wide">
                        {item.format}
                      </span>
                      <span className="text-slate-400">
                        {item.count} requests ({percent}%) • {formatBytes(item.bytes)}
                      </span>
                    </div>
                    <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${barColor} rounded-full transition-all duration-500`}
                        style={{ width: `${Math.max(2, percent)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Top 10 Media Assets Table */}
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-amber-400" />
                  Top Media Assets Được Gọi Nhiều Nhất
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Xếp hạng các tài nguyên có lưu lượng tải cao nhất trong chu kỳ
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 uppercase text-[11px] font-semibold">
                    <th className="pb-3 font-semibold">Media Asset</th>
                    <th className="pb-3 font-semibold text-right">Lượt Gọi</th>
                    <th className="pb-3 font-semibold text-right">Băng Thông</th>
                    <th className="pb-3 font-semibold text-right">Hành Động</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {data?.topAssets.map((asset, idx) => (
                    <tr key={asset.assetId} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-slate-400 text-xs w-4">{idx + 1}.</span>
                          <div className="h-8 w-8 rounded-lg bg-slate-800 border border-slate-700/60 flex items-center justify-center overflow-hidden flex-shrink-0">
                            {asset.storageUrl ? (
                              <img
                                src={`/api/v1/delivery/${asset.assetId}?w=64&q=60`}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <HardDrive className="h-4 w-4 text-slate-400" />
                            )}
                          </div>
                          <div className="min-w-0 max-w-[200px] sm:max-w-xs">
                            <p className="font-semibold text-slate-200 truncate">{asset.displayName}</p>
                            <p className="font-mono text-[10px] text-slate-400 truncate">{asset.assetId}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 text-right font-semibold text-white">
                        {asset.requestsCount.toLocaleString()}
                      </td>
                      <td className="py-3 text-right font-mono text-slate-300">
                        {formatBytes(asset.bytesTransferred)}
                      </td>
                      <td className="py-3 text-right">
                        <a
                          href={`/api/v1/delivery/${asset.assetId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-violet-400 hover:text-violet-300 font-medium"
                        >
                          <span>Xem</span>
                          <ArrowUpRight className="h-3 w-3" />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Column: Live Event Stream & CDN Summary */}
        <div className="space-y-8">
          {/* CDN Edge Architecture Card */}
          <div className="bg-gradient-to-br from-violet-950/40 via-slate-900/60 to-slate-950/80 border border-violet-800/30 rounded-2xl p-6 backdrop-blur-sm">
            <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-3">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              Cơ Chế Tối Ưu Băng Thông
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed mb-4">
              Hệ thống kết hợp bộ nén <strong>Sharp AVIF/WebP</strong> với tiêu đề <strong>ETag Deterministic</strong>. Khi các ứng dụng ngoại vi (Web, App) gọi lại ảnh cũ, server trả về mã <strong>304 Not Modified</strong> với độ trễ &lt; 5ms và kích thước 0 byte.
            </p>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-[11px] font-mono text-slate-400 space-y-1">
              <div>Cache-Control: public, max-age=31536000</div>
              <div>X-Media-Transform: sharp-smart-crop</div>
            </div>
          </div>

          {/* Live Request Stream */}
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Clock className="h-4 w-4 text-blue-400" />
                Live Request Stream
              </h3>
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            </div>

            <div className="space-y-3">
              {data?.recentEvents.map((evt) => (
                <div
                  key={evt.id}
                  className="p-2.5 rounded-xl bg-slate-950/50 border border-slate-800/60 text-xs flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                        evt.eventType === 'cache_hit'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-violet-500/10 text-violet-400 border border-violet-500/20'
                      }`}
                    >
                      {evt.eventType === 'cache_hit' ? '304 HIT' : '200 TRANSFORM'}
                    </span>
                    <span className="font-mono text-slate-300 truncate text-[11px]">
                      {evt.assetId || 'media'}
                    </span>
                  </div>

                  <div className="text-right text-[11px] font-mono flex-shrink-0">
                    <span className="text-slate-400">{evt.latencyMs}ms</span>
                    <span className="mx-1 text-slate-600">•</span>
                    <span className="text-emerald-400 font-semibold">{formatBytes(evt.bytesTransferred)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
