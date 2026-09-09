'use client';

import React, { useState, useEffect } from 'react';
import { Sliders, Zap, Check, Copy, Code2, Sparkles, Image as ImageIcon, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';

const SAMPLE_TRANSFORM_ASSETS = [
  {
    id: 'med_demo_nike_sneaker',
    name: 'Nike Air Jordan Cyberpunk',
    origSize: 485200,
    origDims: '2400 x 1600 px',
  },
  {
    id: 'med_demo_smartwatch',
    name: 'Minimalist Titanium Smartwatch',
    origSize: 394100,
    origDims: '2000 x 1500 px',
  },
  {
    id: 'med_demo_modern_villa',
    name: 'Nordic Modernist Villa',
    origSize: 684200,
    origDims: '2560 x 1440 px',
  },
  {
    id: 'med_demo_tokyo_night',
    name: 'Tokyo Neon Cyberpunk',
    origSize: 842100,
    origDims: '3840 x 2160 px',
  },
];

export function TransformationLab() {
  const [selectedAssetId, setSelectedAssetId] = useState(SAMPLE_TRANSFORM_ASSETS[0].id);
  const [width, setWidth] = useState(450);
  const [format, setFormat] = useState<'webp' | 'avif' | 'jpeg' | 'png'>('webp');
  const [quality, setQuality] = useState(80);
  const [fit, setFit] = useState<'cover' | 'contain' | 'fill' | 'smart'>('cover');
  const [watermarkEnabled, setWatermarkEnabled] = useState(false);
  const [watermarkText, setWatermarkText] = useState('MEDIA PLATFORM');

  const [loadingImage, setLoadingImage] = useState(false);
  const [imageSize, setImageSize] = useState<number | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedHtml, setCopiedHtml] = useState(false);

  const currentAsset = SAMPLE_TRANSFORM_ASSETS.find((a) => a.id === selectedAssetId) || SAMPLE_TRANSFORM_ASSETS[0];

  const watermarkQuery = watermarkEnabled ? `&watermark=${encodeURIComponent(watermarkText)}` : '';
  const deliveryUrl = `/api/v1/delivery/${currentAsset.id}?w=${width}&format=${format}&q=${quality}&fit=${fit}${watermarkQuery}`;

  // Fetch head/metrics for transformed image size
  useEffect(() => {
    let active = true;
    setLoadingImage(true);

    fetch(deliveryUrl)
      .then((res) => {
        if (!res.ok) throw new Error('Transform error');
        return res.blob();
      })
      .then((blob) => {
        if (active) {
          setImageSize(blob.size);
          setLoadingImage(false);
        }
      })
      .catch(() => {
        if (active) setLoadingImage(false);
      });

    return () => {
      active = false;
    };
  }, [deliveryUrl]);

  const copyUrl = () => {
    const full = `${window.location.origin}${deliveryUrl}`;
    navigator.clipboard.writeText(full);
    setCopiedUrl(true);
    toast.success('Đã sao chép CDN URL!');
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const copyHtml = () => {
    const origin = window.location.origin;
    const html = `<picture>
  <source type="image/avif" srcset="${origin}/api/v1/delivery/${currentAsset.id}?w=${width}&format=avif&q=${quality}" />
  <source type="image/webp" srcset="${origin}/api/v1/delivery/${currentAsset.id}?w=${width}&format=webp&q=${quality}" />
  <img src="${origin}/api/v1/delivery/${currentAsset.id}?w=${width}&format=jpeg&q=${quality}" alt="${currentAsset.name}" loading="lazy" decoding="async" />
</picture>`;
    navigator.clipboard.writeText(html);
    setCopiedHtml(true);
    toast.success('Đã sao chép thẻ <picture> responsive HTML!');
    setTimeout(() => setCopiedHtml(false), 2000);
  };

  const origKb = (currentAsset.origSize / 1024).toFixed(1);
  const transformedKb = imageSize ? (imageSize / 1024).toFixed(1) : null;
  const savings = imageSize ? (((currentAsset.origSize - imageSize) / currentAsset.origSize) * 100).toFixed(1) : null;

  return (
    <section id="transformation" className="py-20 border-b border-slate-800/80 bg-slate-900/40 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="inline-flex items-center gap-2 text-xs font-semibold px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 mb-3">
            <Zap className="w-3.5 h-3.5" />
            <span>High-Speed Sharp Image Processing</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            Thử Nghiệm Biến Đổi Ảnh On-The-Fly (CDN Lab)
          </h2>
          <p className="mt-3 text-sm sm:text-base text-slate-400">
            Tự động crop, resize và chuyển định dạng thế hệ mới (AVIF/WebP) chỉ bằng query parameters trên URL. 
            Tiết kiệm tới 95% băng thông tải trang cho client.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Controls Column (5 cols) */}
          <div className="lg:col-span-5 bg-slate-950/80 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-md">
            <h3 className="font-bold text-sm text-slate-200 flex items-center gap-2 pb-4 border-b border-slate-800">
              <Sliders className="w-4 h-4 text-sky-400" />
              <span>Bảng Điều Khiển Tham Số URL</span>
            </h3>

            {/* Select Asset */}
            <div className="mt-5">
              <label className="block text-xs font-medium text-slate-400 mb-2">Chọn ảnh mẫu kiểm thử:</label>
              <div className="grid grid-cols-2 gap-2">
                {SAMPLE_TRANSFORM_ASSETS.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedAssetId(item.id)}
                    className={`p-2.5 rounded-xl border text-left text-xs font-medium transition-all cursor-pointer ${
                      selectedAssetId === item.id
                        ? 'bg-sky-500/15 border-sky-500/50 text-sky-300'
                        : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                    }`}
                  >
                    <span className="line-clamp-1 block">{item.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Width Slider */}
            <div className="mt-5">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="text-slate-400 font-medium">Chiều rộng (Width ?w=):</span>
                <span className="text-sky-400 font-mono font-bold">{width} px</span>
              </div>
              <input
                type="range"
                min="120"
                max="1200"
                step="20"
                value={width}
                onChange={(e) => setWidth(parseInt(e.target.value, 10))}
                className="w-full accent-sky-500 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-600 font-mono mt-1">
                <span>120px (Thumb)</span>
                <span>450px (Mobile)</span>
                <span>800px (Tablet)</span>
                <span>1200px (Desktop)</span>
              </div>
            </div>

            {/* Format Selection */}
            <div className="mt-5">
              <label className="block text-xs font-medium text-slate-400 mb-2">Định dạng nén (?format=):</label>
              <div className="grid grid-cols-4 gap-2">
                {(['webp', 'avif', 'jpeg', 'png'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => setFormat(fmt)}
                    className={`py-2 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer uppercase ${
                      format === fmt
                        ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/25'
                        : 'bg-slate-900 border border-slate-800 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            </div>

            {/* Quality Slider */}
            <div className="mt-5">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="text-slate-400 font-medium">Chất lượng nén (?q=):</span>
                <span className="text-emerald-400 font-mono font-bold">{quality}%</span>
              </div>
              <input
                type="range"
                min="20"
                max="100"
                step="5"
                value={quality}
                onChange={(e) => setQuality(parseInt(e.target.value, 10))}
                className="w-full accent-emerald-500 cursor-pointer"
              />
            </div>

            {/* Fit Mode */}
            <div className="mt-5">
              <label className="block text-xs font-medium text-slate-400 mb-2">Chế độ căn chỉnh (?fit=):</label>
              <div className="grid grid-cols-4 gap-2">
                {(['cover', 'contain', 'fill', 'smart'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setFit(mode)}
                    className={`py-1.5 rounded-lg text-xs font-mono capitalize transition-all cursor-pointer ${
                      fit === mode
                        ? 'bg-purple-500/20 border border-purple-500/40 text-purple-300 font-bold'
                        : 'bg-slate-900 border border-slate-800 text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {mode === 'smart' ? '✨ Smart' : mode}
                  </button>
                ))}
              </div>
            </div>

            {/* Dynamic Watermark Toggle */}
            <div className="mt-5 p-3 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-300">Đóng dấu Watermark (?watermark=)</span>
                <button
                  onClick={() => setWatermarkEnabled(!watermarkEnabled)}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                    watermarkEnabled
                      ? 'bg-sky-500 text-white shadow-sm shadow-sky-500/30'
                      : 'bg-slate-800 text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {watermarkEnabled ? 'BẬT' : 'TẮT'}
                </button>
              </div>
              {watermarkEnabled && (
                <input
                  type="text"
                  value={watermarkText}
                  onChange={(e) => setWatermarkText(e.target.value)}
                  placeholder="Nhập chữ watermark..."
                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-sky-500 font-mono"
                />
              )}
            </div>

            {/* Code Generation Buttons */}
            <div className="mt-6 pt-4 border-t border-slate-800 flex flex-col gap-2">
              <button
                onClick={copyUrl}
                className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-200 flex items-center justify-center gap-2 cursor-pointer transition-all"
              >
                {copiedUrl ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-sky-400" />}
                <span>{copiedUrl ? 'Đã sao chép' : 'Sao chép URL Trực Tiếp'}</span>
              </button>

              <button
                onClick={copyHtml}
                className="w-full py-2.5 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-xs font-semibold text-sky-400 flex items-center justify-center gap-2 cursor-pointer transition-all"
              >
                {copiedHtml ? <Check className="w-4 h-4 text-emerald-400" /> : <Code2 className="w-4 h-4 text-sky-400" />}
                <span>{copiedHtml ? 'Đã sao chép' : 'Sao chép mã thẻ <picture>'}</span>
              </button>
            </div>
          </div>

          {/* Real-time Preview Column (7 cols) */}
          <div className="lg:col-span-7 flex flex-col gap-5">
            {/* Live Visual Canvas */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl p-4 flex flex-col items-center justify-center min-h-[380px] relative">
              {loadingImage && (
                <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center z-10">
                  <div className="text-xs font-mono text-sky-400 flex items-center gap-2">
                    <span className="w-3 h-3 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
                    Transcoding on Server...
                  </div>
                </div>
              )}

              <div className="w-full flex justify-center items-center overflow-auto p-2">
                <img
                  src={deliveryUrl}
                  alt="Transformed Preview"
                  style={{ maxWidth: `${width}px` }}
                  className="rounded-xl shadow-lg border border-slate-800/80 object-cover transition-all duration-300"
                />
              </div>

              <div className="w-full mt-3 flex items-center justify-between text-[11px] font-mono text-slate-500 px-2">
                <span>Rendering width: {width}px</span>
                <span>Format: {format.toUpperCase()}</span>
                <span>Quality: {quality}%</span>
              </div>
            </div>

            {/* Performance Metrics Stats Card */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-5 grid grid-cols-3 gap-4 text-center">
              <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                <span className="text-[11px] text-slate-500 font-medium block">Dung lượng gốc:</span>
                <span className="text-sm sm:text-base font-extrabold text-slate-300 font-mono mt-1 block">
                  {origKb} KB
                </span>
                <span className="text-[10px] text-slate-600 block mt-0.5">{currentAsset.origDims}</span>
              </div>

              <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800">
                <span className="text-[11px] text-slate-500 font-medium block">Dung lượng sau nén:</span>
                <span className="text-sm sm:text-base font-extrabold text-emerald-400 font-mono mt-1 block">
                  {transformedKb ? `${transformedKb} KB` : '...'}
                </span>
                <span className="text-[10px] text-emerald-500/80 block mt-0.5">{format.toUpperCase()} Transcoded</span>
              </div>

              <div className="bg-slate-900/60 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5">
                <span className="text-[11px] text-emerald-400 font-medium block">Tiết kiệm băng thông:</span>
                <span className="text-lg sm:text-xl font-extrabold text-emerald-300 font-mono mt-0.5 block">
                  {savings ? `-${savings}%` : '...'}
                </span>
                <span className="text-[10px] text-emerald-400/80 block">Faster Load Speed</span>
              </div>
            </div>

            {/* Endpoint Preview Snippet */}
            <div className="bg-slate-950 rounded-xl p-3 border border-slate-800/80 font-mono text-xs flex items-center justify-between text-slate-400">
              <div className="truncate mr-3">
                <span className="text-sky-400 font-bold">GET</span>{' '}
                <span className="text-slate-300">{deliveryUrl}</span>
              </div>
              <button
                onClick={copyUrl}
                className="text-slate-500 hover:text-slate-300 p-1 rounded cursor-pointer"
                title="Copy URL"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
