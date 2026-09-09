'use client';

import { Rocket, Cpu, Sparkles, Database, Network, CheckCircle2 } from 'lucide-react';

const ROADMAP_PILLARS = [
  {
    icon: Network,
    iconColor: 'text-blue-400',
    title: '1. Edge Dynamic Media Processing',
    summary: 'Xử lý biến thể ảnh ngay tại CDN Edge (Cloudflare Workers / Fastly Compute)',
    benefits: [
      'Độ trễ xử lý toàn cầu < 30ms (xử lý ngay tại máy chủ gần người dùng nhất).',
      'Giảm 80% lưu lượng truy cập trực tiếp về Origin Server trung tâm.',
      'Tự động nhận diện thiết bị (Client Hints) để gửi AVIF cho Chrome và WebP cho Safari.'
    ]
  },
  {
    icon: Sparkles,
    iconColor: 'text-violet-400',
    title: '2. AI-Powered Media Intelligence',
    summary: 'Tích hợp mô hình AI Vision (CLIP / LLaVA / Florence-2)',
    benefits: [
      'Smart Focal Point Cropping: Tự động crop thông minh tập trung vào khuôn mặt hoặc vật thể chính thay vì chỉ crop ở tâm.',
      'Auto Alt-Text & Captioning: Tự động sinh mô tả ảnh chuẩn SEO và Accessibility WCAG 2.1.',
      'Content Safety Moderation: Tự động phát hiện và cảnh báo nội dung nhạy cảm hoặc vi phạm bản quyền.'
    ]
  },
  {
    icon: Database,
    iconColor: 'text-emerald-400',
    title: '3. Vector Semantic Search (pgvector)',
    summary: 'Tìm kiếm hình ảnh thông minh bằng ngôn ngữ tự nhiên không cần đúng từ khóa chính xác',
    benefits: [
      'Cho phép người dùng gõ: "áo len đỏ chụp ngoài công viên mùa thu" -> tìm được ảnh ngay cả khi file tên "IMG_0042.jpg".',
      'Visual Similarity: Nút "Tìm ảnh tương tự" (Find Similar Assets) cho các sàn thương mại điện tử.',
      'Vector Embedding được tính toán và lưu trực tiếp trong PostgreSQL với chỉ mục HNSW/IVFFlat.'
    ]
  },
  {
    icon: Cpu,
    iconColor: 'text-amber-400',
    title: '4. Asynchronous Video Encoding Pipeline',
    summary: 'Hệ thống Queue phân tán xử lý Video đa luồng (Redis / BullMQ / AWS Elemental)',
    benefits: [
      'Tự động chuyển đổi video MP4 sang chuẩn Adaptive Bitrate HLS (.m3u8) và DASH.',
      'Tạo sẵn 4 chất lượng: 1080p, 720p, 480p, 360p cho kết nối mạng chập chờn.',
      'Tự động trích xuất Animated WebP preview (GIF preview) 5 giây khi rê chuột.'
    ]
  }
];

export function ArchitectureRoadmapSection() {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-bold text-slate-100 tracking-tight flex items-center gap-2">
          <Rocket className="h-5 w-5 text-violet-400" />
          Nghiên Cứu & Đề Xuất Kiến Trúc Hiện Đại Hóa Media Platform
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Lộ trình công nghệ mở rộng (Scalability Roadmap) chuẩn bị cho quy mô hàng triệu người dùng và hàng Terabyte media
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {ROADMAP_PILLARS.map((pillar) => {
          const Icon = pillar.icon;
          return (
            <div key={pillar.title} className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-slate-950 border border-slate-800">
                  <Icon className={"h-5 w-5 " + pillar.iconColor} />
                </div>
                <h3 className="text-sm font-bold text-slate-100">{pillar.title}</h3>
              </div>

              <p className="text-xs text-slate-300 font-medium leading-relaxed">
                {pillar.summary}
              </p>

              <div className="space-y-1.5 pt-1 border-t border-slate-800/80">
                {pillar.benefits.map((b, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-xs text-slate-400">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <span>{b}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
