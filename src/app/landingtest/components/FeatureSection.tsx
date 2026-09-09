'use client';

import React from 'react';
import { Layers, Zap, ShieldCheck, Database, RefreshCw, Key, ArrowRight, ShieldAlert, Cpu, CheckCircle } from 'lucide-react';
import Link from 'next/link';

const FEATURES = [
  {
    icon: Database,
    color: 'text-sky-400',
    bgColor: 'bg-sky-500/10 border-sky-500/20',
    title: 'Một Nền Tảng — Dùng Chung Mọi Dự Án',
    desc: 'Tập trung toàn bộ media của công ty tại một nơi. Khi mở thêm app mới, landing page, hay web bán hàng, chỉ cần tạo API Key và gọi trực tiếp, không phải code lại từ đầu.',
  },
  {
    icon: Zap,
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10 border-emerald-500/20',
    title: 'CDN Edge Image Resizing & ETag Caching',
    desc: 'Tự động crop/resize ảnh theo kích thước thiết bị người dùng. Nén WebP/AVIF giảm 90% dung lượng và hỗ trợ ETag 304 Not Modified tiết kiệm 100% băng thông tải lại.',
  },
  {
    icon: ShieldCheck,
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10 border-purple-500/20',
    title: 'Zero-Trust Scoped Security & Multi-Tenancy',
    desc: 'Bảo mật tuyệt đối với API Key phân quyền chi tiết (assets:read, assets:write, uploads:create) và cô lập ranh giới dữ liệu giữa các Workspace không bao giờ bị rò rỉ.',
  },
  {
    icon: ShieldAlert,
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10 border-amber-500/20',
    title: 'Safe Delete Reference Guard',
    desc: 'Khi một ảnh được gắn vào sản phẩm, banner hay bài viết trên website ngoại vi, hệ thống tự động khóa bảo vệ, ngăn chặn tuyệt đối tình trạng nhân viên xóa nhầm làm hỏng giao diện.',
  },
  {
    icon: Cpu,
    color: 'text-indigo-400',
    bgColor: 'bg-indigo-500/10 border-indigo-500/20',
    title: 'Anti-N+1 Batch Resolving API',
    desc: 'Trang danh sách sản phẩm hay bài viết chỉ cần gửi danh sách ID trong 1 HTTP request duy nhất để phân giải toàn bộ URL ảnh biến thể, chấm dứt tình trạng N+1 HTTP calls.',
  },
  {
    icon: RefreshCw,
    color: 'text-teal-400',
    bgColor: 'bg-teal-500/10 border-teal-500/20',
    title: 'Outbound HMAC-SHA256 Signed Webhooks',
    desc: 'Tự động bắn thông báo thời gian thực về máy chủ của bạn khi có media mới được upload, gắn chữ ký số HMAC-SHA256 đảm bảo an toàn tuyệt đối chống giả mạo.',
  },
];

export function FeatureSection() {
  return (
    <section id="features" className="py-20 border-b border-slate-800/80 bg-slate-950 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 text-xs font-semibold px-2.5 py-1 rounded-md bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 mb-3">
            <Layers className="w-3.5 h-3.5" />
            <span>Enterprise Headless DAM Architecture</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            Tại Sao Nên Chọn Giải Pháp Headless DAM Tập Trung?
          </h2>
          <p className="mt-3 text-sm sm:text-base text-slate-400">
            Giải quyết dứt điểm sự phân mảnh lưu trữ, giảm thiểu chi phí máy chủ và đẩy nhanh tốc độ phát triển cho mọi đội ngũ kỹ thuật.
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {FEATURES.map((feat, idx) => {
            const Icon = feat.icon;
            return (
              <div
                key={idx}
                className="bg-slate-900/50 hover:bg-slate-900 border border-slate-800/80 hover:border-slate-700 p-6 rounded-2xl transition-all duration-300 shadow-lg group hover:-translate-y-1"
              >
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center border mb-5 ${feat.bgColor}`}>
                  <Icon className={`w-6 h-6 ${feat.color}`} />
                </div>
                <h3 className="text-lg font-bold text-slate-200 group-hover:text-white transition-colors mb-2">
                  {feat.title}
                </h3>
                <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                  {feat.desc}
                </p>
              </div>
            );
          })}
        </div>

        {/* Integration Comparison Banner */}
        <div className="mt-16 bg-gradient-to-r from-sky-950/40 via-slate-900 to-purple-950/40 border border-slate-800 rounded-3xl p-8 lg:p-10 flex flex-col md:flex-row items-center justify-between gap-6 shadow-2xl">
          <div className="max-w-2xl">
            <h3 className="text-2xl font-bold text-white tracking-tight">
              Sẵn Sàng Tích Hợp Cho Ứng Dụng Tiếp Theo Của Bạn?
            </h3>
            <p className="mt-2 text-sm text-slate-300">
              Khám phá toàn bộ cẩm nang tích hợp SDK, tài liệu API v1, chính sách bảo trì LTS và cơ chế phân trang tối ưu trong Dashboard Knowledge Hub.
            </p>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            <Link
              href="/docs"
              className="px-6 py-3 rounded-xl bg-white hover:bg-slate-100 text-slate-950 font-bold text-sm shadow-xl transition-all hover:scale-105 flex items-center gap-2 cursor-pointer"
            >
              <span>Xem Tài Liệu API</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
