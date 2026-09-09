'use client';

import { FolderTree, ShieldCheck, Lock, ExternalLink, Sparkles, AlertTriangle } from 'lucide-react';

export function UserGuideSection() {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-bold text-slate-100 tracking-tight flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-violet-400" />
          Hướng Dẫn Quản Lý Tài Nguyên & Quy Trình Vận Hành
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Cẩm nang nghiệp vụ dành cho Người dùng (Editor, Admin, Owner) quản trị kho Media tập trung
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Card 1: Folders vs Collections */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <div className="flex items-center gap-2.5 text-violet-400 font-semibold text-sm">
            <FolderTree className="h-5 w-5" />
            <span>1. Thư Mục (Folders) vs Bộ Sưu Tập (Collections)</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Hệ thống phân cấp tài nguyên dựa trên hai mô hình tổ chức dữ liệu song song:
          </p>
          <ul className="space-y-2 text-xs text-slate-300">
            <li className="flex items-start gap-2">
              <span className="text-violet-400 font-bold">•</span>
              <div>
                <strong className="text-slate-100">Folders (Vật lý):</strong> Mỗi media file chỉ thuộc về duy nhất một thư mục. Phù hợp cho cấu trúc phòng ban, chiến dịch theo năm (vd: <code>Marketing/2026/Campaign-Summer</code>).
              </div>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-violet-400 font-bold">•</span>
              <div>
                <strong className="text-slate-100">Collections (Logic):</strong> Một file có thể nằm trong nhiều bộ sưu tập cùng lúc mà không nhân bản dữ liệu (Zero storage duplication). Phù hợp gom nhóm sản phẩm nổi bật, banner lễ tết.
              </div>
            </li>
          </ul>
        </div>

        {/* Card 2: Safe Delete Reference Guard */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <div className="flex items-center gap-2.5 text-emerald-400 font-semibold text-sm">
            <Lock className="h-5 w-5" />
            <span>2. Cơ Chế Khóa An Toàn (Safe Delete Guard)</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Ngăn chặn triệt để sự cố xóa nhầm ảnh đang được hiển thị trên website bán hàng hoặc ứng dụng di động:
          </p>
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-300 space-y-1.5">
            <div className="flex items-center gap-2 text-amber-400 font-semibold">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>Quy tắc bảo vệ 2 lớp:</span>
            </div>
            <div>
              1. Khi website khác nhúng ảnh, họ gọi <code>POST /api/v1/references</code> để gắn <em>Usage Lock</em>.
            </div>
            <div>
              2. Nếu ai đó bấm Xóa trên Media Platform, hệ thống sẽ <strong>chặn thao tác</strong> và báo lỗi <code>ASSET_IN_USE</code> kèm danh sách các trang đang dùng ảnh này!
            </div>
          </div>
        </div>

        {/* Card 3: RBAC & Permissions */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <div className="flex items-center gap-2.5 text-blue-400 font-semibold text-sm">
            <ShieldCheck className="h-5 w-5" />
            <span>3. Phân Quyền Zero-Trust RBAC & Lời Mời</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Hệ thống phân chia 5 vai trò với quyền hạn tối thiểu:
          </p>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800">
              <span className="font-mono text-violet-400 font-semibold text-[11px]">Owner / Admin</span>
              <span className="text-[11px] text-slate-400">Toàn quyền cấu hình, xóa vĩnh viễn, mời thành viên</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800">
              <span className="font-mono text-emerald-400 font-semibold text-[11px]">Editor</span>
              <span className="text-[11px] text-slate-400">Upload, sửa metadata, tạo folder, chuyển vào thùng rác</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800">
              <span className="font-mono text-amber-400 font-semibold text-[11px]">Developer</span>
              <span className="text-[11px] text-slate-400">Quản lý API Keys, ứng dụng ngoại vi và Webhooks</span>
            </div>
            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800">
              <span className="font-mono text-slate-400 font-semibold text-[11px]">Viewer</span>
              <span className="text-[11px] text-slate-400">Chỉ xem và lấy URL delivery tối ưu hóa</span>
            </div>
          </div>
        </div>

        {/* Card 4: Embeddable Picker Widget */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <div className="flex items-center gap-2.5 text-amber-400 font-semibold text-sm">
            <ExternalLink className="h-5 w-5" />
            <span>4. Hộp Thoại Chọn Media Nhúng (Picker Widget)</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Tích hợp giao diện chọn ảnh độc lập vào bất kỳ CMS, Admin Panel hoặc Landing Page nào mà không cần viết lại giao diện:
          </p>
          <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 font-mono text-[11px] text-violet-300 overflow-x-auto">
            media.openPicker(&#123; multiple: false, onSelect: (asset) =&gt; console.log(asset.storage_url) &#125;);
          </div>
          <p className="text-[11px] text-slate-400">
            Hỗ trợ giao tiếp 2 chiều an toàn bằng <code>window.postMessage</code>.
          </p>
        </div>
      </div>
    </div>
  );
}
