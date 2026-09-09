'use client';

import { Zap, Layers, RefreshCw, Cpu, Check, Copy, Flame } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

export function PerformanceGuideSection() {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    toast.success('Đã sao chép mã nguồn mẫu');
    setTimeout(() => setCopied(null), 2000);
  };

  const batchSnippet = '// KHUYÊN DÙNG: Lấy 50 ảnh sản phẩm trong 1 request duy nhất (Anti N+1)\n' +
    'const { assets } = await media.getAssetsBatch(\n' +
    '  productMediaIds, // Array 50 items: [\'med_01\', \'med_02\', ...]\n' +
    '  {\n' +
    '    fields: [\'id\', \'display_name\', \'storage_url\'], // Chỉ lấy các trường cần thiết\n' +
    '    transform: { width: 600, format: \'webp\', quality: 80 }\n' +
    '  }\n' +
    ');';

  const responsiveSnippet = '// Tự động sinh <picture> chuẩn responsive cho Mobile & Retina Display\n' +
    'const responsive = media.getResponsivePictureSet(asset.id, {\n' +
    '  widths: [320, 640, 960, 1200],\n' +
    '  formats: [\'avif\', \'webp\'],\n' +
    '  quality: 80\n' +
    '});\n\n' +
    '// Chèn trực tiếp vào JSX / HTML:\n' +
    'return <div dangerouslySetInnerHTML={{ __html: responsive.html }} />;';

  const cursorSnippet = '// Phân trang Cursor Pagination cho Infinite Scroll\n' +
    'let nextCursor = undefined;\n' +
    'async function loadMoreItems() {\n' +
    '  const res = await media.listAssets({\n' +
    '    cursor: nextCursor,\n' +
    '    limit: 24,\n' +
    '    type: \'image\'\n' +
    '  });\n' +
    '  nextCursor = res.pagination?.next_cursor;\n' +
    '  appendAssetsToView(res.data);\n' +
    '}';

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-bold text-slate-100 tracking-tight flex items-center gap-2">
          <Zap className="h-5 w-5 text-amber-400" />
          Cẩm Nang Tối Ưu Hiệu Năng & Tải Trọng API (High-Performance Engine)
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Các kỹ thuật tăng tốc độ phản hồi từ 1200ms xuống dưới 35ms khi tích hợp vào hệ thống ngoại vi
        </p>
      </div>

      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-2">
            <Layers className="h-4 w-4 text-violet-400" />
            1. Giải Quyết Triệt Để N+1 API Calls qua Batch Resolving
          </h3>
          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            97% Latency Reduction
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-rose-950/20 border border-rose-500/20 space-y-2">
            <div className="text-xs font-bold text-rose-400 flex items-center gap-1.5">
              <span>❌ Cách làm cũ (N+1 Calls):</span>
            </div>
            <p className="text-[11px] text-slate-300">
              Trang danh mục 50 sản phẩm gửi <strong>50 HTTP requests riêng lẻ</strong> về Media Platform.
            </p>
            <div className="p-2 rounded bg-slate-950 font-mono text-[11px] text-rose-300">
              50 requests × 40ms = <strong>2,000ms (2 giây)</strong>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/20 space-y-2">
            <div className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
              <span>✅ Chuẩn tối ưu mới (POST /api/v1/assets/batch):</span>
            </div>
            <p className="text-[11px] text-slate-300">
              Gửi <strong>1 HTTP request duy nhất</strong> mang theo mảng 50 ID. Server resolve đồng thời.
            </p>
            <div className="p-2 rounded bg-slate-950 font-mono text-[11px] text-emerald-300">
              1 request = <strong>35ms (Nhanh gấp 50 lần)</strong>
            </div>
          </div>
        </div>

        <div className="space-y-2 pt-2">
          <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
            <span>SDK Batch Resolving Code:</span>
            <button
              onClick={() => copy(batchSnippet, 'batch')}
              className="flex items-center gap-1 text-[11px] text-violet-400 hover:text-violet-300"
            >
              {copied === 'batch' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
              <span>Copy code</span>
            </button>
          </div>
          <pre className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-300 font-mono overflow-x-auto">
            {batchSnippet}
          </pre>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <div className="flex items-center gap-2 text-blue-400 font-semibold text-sm">
            <RefreshCw className="h-4 w-4" />
            <span>2. Phân Trang Hiệu Năng Cao (Cursor vs Offset)</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            - <strong>Offset (<code>?page=1&limit=24</code>):</strong> Phù hợp cho giao diện Web có nút chuyển trang 1, 2, 3.<br />
            - <strong>Cursor (<code>?cursor=med_...&limit=24</code>):</strong> Phù hợp cho Mobile App và Infinite Scroll. Đạt độ phức tạp truy vấn <strong>O(1)</strong>, không bao giờ bị trùng lặp dữ liệu khi có ảnh mới thêm vào.
          </p>
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
              <span>Cursor Infinite Scroll:</span>
              <button onClick={() => copy(cursorSnippet, 'cursor')} className="text-violet-400 hover:text-violet-300">
                {copied === 'cursor' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 text-[11px] text-slate-300 font-mono overflow-x-auto">
              {cursorSnippet}
            </pre>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
            <Cpu className="h-4 w-4" />
            <span>3. Conditional Caching (ETag & 304 Not Modified)</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Hệ thống tự động sinh <code>ETag</code> dựa trên ID và thông số biến thể ảnh.
          </p>
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 space-y-1.5 font-mono">
            <div className="text-[11px] text-slate-400">// Client gửi header:</div>
            <div className="text-emerald-400 text-[11px]">If-None-Match: W/&quot;a8f5c812...&quot;</div>
            <div className="text-[11px] text-slate-400 pt-1">// Server phản hồi:</div>
            <div className="text-violet-400 text-[11px]">HTTP/1.1 304 Not Modified (0 bytes)</div>
          </div>
          <p className="text-[11px] text-slate-400">
            Tiết kiệm 99% băng thông và giảm tải CPU nén ảnh cho máy chủ.
          </p>
        </div>
      </div>

      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider flex items-center gap-2">
            <Flame className="h-4 w-4 text-rose-400" />
            4. Progressive Lazy Loading & Responsive &lt;picture&gt; Generator
          </h3>
        </div>
        <p className="text-xs text-slate-300">
          SDK hỗ trợ hàm <code>media.getResponsivePictureSet(...)</code> tự động tính toán breakpoint cho thiết bị di động, tablet, và màn hình Retina 2x/3x:
        </p>
        <pre className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-300 font-mono overflow-x-auto">
          {responsiveSnippet}
        </pre>
      </div>
    </div>
  );
}
