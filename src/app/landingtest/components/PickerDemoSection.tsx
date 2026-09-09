'use client';

import React, { useState, useEffect } from 'react';
import { ExternalLink, Layers, CheckCircle2, Copy, Sparkles, ArrowUpRight, Code, ShieldCheck } from 'lucide-react';
import { DEMO_CREDENTIALS } from './HeroSection';
import { toast } from 'sonner';

export function PickerDemoSection() {
  const [selectedAssetFromPicker, setSelectedAssetFromPicker] = useState<any | null>(null);
  const [receivedCount, setReceivedCount] = useState(0);

  // Listen to postMessage from embeddable picker window
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Validate event type
      if (event.data?.type === 'MEDIA_ASSET_SELECTED' && event.data?.asset) {
        setSelectedAssetFromPicker(event.data.asset);
        setReceivedCount((prev) => prev + 1);
        toast.success(`Đã nhận asset "${event.data.asset.display_name || event.data.asset.id}" từ Picker qua postMessage!`);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const openPickerPopup = () => {
    const pickerUrl = `/picker?api_key=${DEMO_CREDENTIALS.rawKey}&mode=single`;
    const width = 960;
    const height = 640;
    const left = (window.innerWidth - width) / 2;
    const top = (window.innerHeight - height) / 2;

    const popup = window.open(
      pickerUrl,
      'MediaPlatformPicker',
      `width=${width},height=${height},top=${top},left=${left},resizable=yes,scrollbars=yes,status=no`
    );

    if (popup) {
      popup.focus();
      toast.info('Đang mở hộp thoại Media Picker. Hãy nhấp chọn 1 media để thử nghiệm!');
    } else {
      toast.error('Trình duyệt đã chặn popup. Vui lòng bật cho phép popup để mở Picker!');
    }
  };

  return (
    <section id="picker" className="py-20 border-b border-slate-800/80 bg-slate-950 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          {/* Left Column: Explainer (6 cols) */}
          <div className="lg:col-span-6">
            <div className="inline-flex items-center gap-2 text-xs font-semibold px-2.5 py-1 rounded-md bg-purple-500/10 text-purple-400 border border-purple-500/20 mb-3">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Embeddable Widget for Any App</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              Tích Hợp Hộp Thoại Chọn Media (Embeddable Picker)
            </h2>
            <p className="mt-4 text-sm sm:text-base text-slate-400 leading-relaxed">
              Các ứng dụng bên thứ ba (Trang quản trị CMS, Dashboard thương mại điện tử, Blog builder) 
              có thể nhúng hoặc mở hộp thoại chọn media chuyên nghiệp chỉ với 3 dòng mã JavaScript, không cần cấu hình upload phức tạp.
            </p>

            {/* Steps list */}
            <div className="mt-6 space-y-3 text-xs sm:text-sm text-slate-300">
              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 font-bold flex items-center justify-center shrink-0 text-xs border border-purple-500/30">
                  1
                </div>
                <div>
                  <strong className="text-white">Bypass Login Redirect:</strong> Người dùng gọi Widget thông qua tham số <code className="text-purple-300 font-mono bg-slate-900 px-1 py-0.5 rounded">?api_key=...</code> mà không cần đăng nhập session trên nền tảng.
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 font-bold flex items-center justify-center shrink-0 text-xs border border-purple-500/30">
                  2
                </div>
                <div>
                  <strong className="text-white">Giao tiếp an toàn qua Window postMessage:</strong> Khi người dùng chọn hoặc tải lên media mới, widget tự động dispatch sự kiện <code className="text-sky-300 font-mono bg-slate-900 px-1 py-0.5 rounded">MEDIA_ASSET_SELECTED</code> về ứng dụng cha.
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-purple-500/20 text-purple-400 font-bold flex items-center justify-center shrink-0 text-xs border border-purple-500/30">
                  3
                </div>
                <div>
                  <strong className="text-white">Safe Delete Reference Guard:</strong> Ứng dụng cha có thể tự động gắn reference (ví dụ: gán vào sản phẩm ID 42) để bảo vệ tài nguyên không bị xóa nhầm.
                </div>
              </div>
            </div>

            {/* Launch Action Button */}
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <button
                onClick={openPickerPopup}
                className="px-6 py-3.5 rounded-xl font-semibold text-white bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 shadow-xl shadow-purple-500/25 hover:shadow-purple-500/40 transition-all duration-200 flex items-center gap-2 hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
              >
                <ExternalLink className="w-5 h-5" />
                <span>Mở Embeddable Picker Popup</span>
              </button>

              <div className="text-xs text-slate-500 font-mono flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Zero-Trust Auth Enabled</span>
              </div>
            </div>
          </div>

          {/* Right Column: Live Event Receiver Card (6 cols) */}
          <div className="lg:col-span-6 bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-2xl backdrop-blur-md">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-sky-400 animate-ping" />
                <h3 className="font-bold text-sm text-slate-200">
                  Bộ Nhận Sự Kiện Trực Tiếp (Parent Window Listener)
                </h3>
              </div>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">
                Messages Received: {receivedCount}
              </span>
            </div>

            {/* Status Display */}
            {!selectedAssetFromPicker ? (
              <div className="py-16 text-center">
                <div className="w-14 h-14 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mx-auto mb-4 text-purple-400">
                  <Layers className="w-7 h-7" />
                </div>
                <p className="text-sm font-semibold text-slate-300">Chưa nhận được media nào</p>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Hãy bấm nút &quot;Mở Embeddable Picker Popup&quot; ở bên cạnh, chọn một bức ảnh và xem kết quả xuất hiện ngay tại đây!
                </p>
              </div>
            ) : (
              <div className="mt-4 space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center gap-2 text-xs text-emerald-300 font-semibold">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                  <span>Sự kiện MEDIA_ASSET_SELECTED đã được xử lý thành công!</span>
                </div>

                <div className="flex items-center gap-4 bg-slate-950 p-4 rounded-xl border border-slate-800">
                  <div className="w-20 h-20 rounded-lg overflow-hidden bg-slate-900 border border-slate-800 shrink-0">
                    <img
                      src={`/api/v1/delivery/${selectedAssetFromPicker.id}?w=200&format=webp`}
                      alt={selectedAssetFromPicker.display_name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-sm text-white truncate">
                      {selectedAssetFromPicker.display_name}
                    </h4>
                    <p className="text-xs font-mono text-sky-400 mt-0.5">
                      ID: {selectedAssetFromPicker.id}
                    </p>
                    <p className="text-xs text-slate-400 mt-1 font-mono">
                      {selectedAssetFromPicker.mime_type} • {selectedAssetFromPicker.width}x{selectedAssetFromPicker.height} px
                    </p>
                  </div>
                </div>

                {/* JSON Data Inspector */}
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1.5 font-mono">
                    <span>RECEIVED PAYLOAD (JSON):</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(JSON.stringify(selectedAssetFromPicker, null, 2));
                        toast.success('Đã chép payload JSON!');
                      }}
                      className="text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer"
                    >
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </button>
                  </div>
                  <pre className="text-[11px] font-mono text-emerald-400/90 overflow-x-auto max-h-36 p-2 bg-slate-900/60 rounded-lg">
                    {JSON.stringify(selectedAssetFromPicker, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
