'use client';

import { GitBranch, Calendar, ShieldCheck, CheckCircle, AlertCircle } from 'lucide-react';

const CHANGELOG = [
  {
    version: 'v1.0.0 (LTS)',
    releaseDate: '2026-09-08',
    status: 'ACTIVE_LTS',
    badgeClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    summary: 'Phiên bản ổn định hiện tại của Media Platform',
    features: [
      'Universal Client SDK (@/lib/sdk/mediaClient) cho Node.js, Browser, React, Mobile.',
      'Dynamic Image Delivery (/api/v1/delivery/[id]) hỗ trợ Sharp resizing, WebP/AVIF transcode, ETag 304 Caching.',
      'Batch Resolve API (/api/v1/assets/batch) giải quyết triệt để N+1 queries.',
      'Outbound Webhooks ký số HMAC-SHA256 với lịch sử phát delivery log.',
      'Safe Delete Reference Guard chống xóa nhầm media đang sử dụng.',
      'Embeddable Media Picker Widget (/picker) nhúng popup/iframe với postMessage.'
    ],
    breakingChanges: []
  },
  {
    version: 'v2.0.0-preview',
    releaseDate: '2026-Q4 (Dự kiến)',
    status: 'ROADMAP',
    badgeClass: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
    summary: 'Phiên bản mở rộng hỗ trợ AI Intelligence & Edge Worker streaming',
    features: [
      'AI Vision Auto-tagging & Semantic Vector Search (pgvector).',
      'Smart focal-point crop phát hiện khuôn mặt và chủ thể tự động.',
      'Streaming video transcoder (HLS/DASH) phân giải đa tầng.',
      'GraphQL Subscriptions & gRPC high-throughput sync.'
    ],
    breakingChanges: [
      'Dự kiến chuyển đổi định dạng ngày tháng từ unix timestamp sang ISO-8601 UTC chuẩn.'
    ]
  }
];

export function ApiVersionSection() {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-bold text-slate-100 tracking-tight flex items-center gap-2">
          <GitBranch className="h-5 w-5 text-emerald-400" />
          Quy Chuẩn Quản Lý Phiên Bản API (API Versioning & Lifecycle)
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Chính sách tương thích ngược (Backward Compatibility), quy tắc Header và vòng đời hỗ trợ phiên bản
        </p>
      </div>

      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
          Nguyên Tắc Định Danh Phiên Bản (Dual-Layer Versioning)
        </h3>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
            <span className="text-[11px] font-bold text-violet-400 uppercase font-mono">1. URL Path Versioning</span>
            <div className="text-xs font-mono text-slate-200">https://api.domain.com/api/v1/...</div>
            <p className="text-[11px] text-slate-400">
              Cố định cấu trúc endpoint cốt lõi cho từng phiên bản lớn (Major Breaking Changes).
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
            <span className="text-[11px] font-bold text-emerald-400 uppercase font-mono">2. Date-based Request Header</span>
            <div className="text-xs font-mono text-slate-200">X-Media-Api-Version: 2026-09-01</div>
            <p className="text-[11px] text-slate-400">
              Kiểm soát các thay đổi nhỏ, trường bổ sung mà không làm gián đoạn hệ thống cũ.
            </p>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300 flex items-start gap-2.5">
          <ShieldCheck className="h-4 w-4 flex-shrink-0 mt-0.5 text-blue-400" />
          <div>
            <strong>Cam kết ổn định (LTS Guarantee):</strong> Mọi phiên bản Major (v1) được cam kết duy trì ít nhất <strong>24 tháng</strong> kể từ ngày công bố phiên bản kế tiếp. Thời gian cảnh báo Deprecation tối thiểu là <strong>6 tháng</strong> qua header <code>Sunset</code> và email quản trị.
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
          Lịch Sử Phiên Bản & Thay Đổi (Changelog)
        </h3>

        <div className="space-y-4">
          {CHANGELOG.map((log) => (
            <div key={log.version} className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="text-base font-bold text-slate-100 font-mono">{log.version}</span>
                  <span className={"px-2.5 py-0.5 rounded text-[10px] font-bold uppercase border " + log.badgeClass}>
                    {log.status}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>Phát hành: {log.releaseDate}</span>
                </div>
              </div>

              <p className="text-xs text-slate-300 font-medium">{log.summary}</p>

              <div className="space-y-1.5 pt-1">
                <div className="text-[11px] font-semibold uppercase text-slate-400">Tính năng & Nâng cấp:</div>
                <ul className="space-y-1">
                  {log.features.map((feat, idx) => (
                    <li key={idx} className="text-xs text-slate-300 flex items-start gap-2">
                      <CheckCircle className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {log.breakingChanges.length > 0 && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 space-y-1">
                  <div className="font-semibold flex items-center gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5" />
                    <span>Breaking Changes:</span>
                  </div>
                  <ul className="list-disc list-inside space-y-0.5">
                    {log.breakingChanges.map((bc, idx) => (
                      <li key={idx}>{bc}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
