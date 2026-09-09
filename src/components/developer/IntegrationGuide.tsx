'use client';

import { useState } from 'react';
import { Copy, Check, Terminal, Code2, Globe, Sparkles, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

interface IntegrationGuideProps {
  apiKeys: { id: string; name: string; key_prefix: string }[];
}

export function IntegrationGuide({ apiKeys }: IntegrationGuideProps) {
  const [selectedKey, setSelectedKey] = useState(apiKeys[0]?.key_prefix || 'mda_live_your_api_key');
  const [activeTab, setActiveTab] = useState<'node' | 'react' | 'curl' | 'picker'>('node');
  const [copied, setCopied] = useState(false);

  const displayKey = selectedKey.includes('...') ? selectedKey : `${selectedKey}...`;

  const snippets = {
    node: `// 1. Install or import the client SDK
import { MediaClient } from './mediaClient';

// 2. Initialize with your project API Key
const media = new MediaClient({
  apiKey: '${displayKey}',
  baseUrl: 'http://localhost:3000' // or https://your-media-domain.com
});

// 3. Upload media (Node buffer or browser File)
async function uploadProductBanner(fileBuffer) {
  const asset = await media.upload(fileBuffer, {
    displayName: 'Summer Collection Banner',
    folderId: 'fld_banners',
    visibility: 'public',
    tags: ['summer', 'campaign-2026']
  });

  console.log('Uploaded asset ID:', asset.id);
  console.log('CDN URL:', asset.storage_url);

  // 4. Safe Delete: Lock asset to prevent accidental deletion from DAM
  await media.attachReference({
    assetId: asset.id,
    sourceApp: 'ecommerce',
    entityType: 'product',
    entityId: 'prod_summer_dress_42'
  });

  // 5. Generate dynamic responsive image URL (WebP, 800px width)
  const responsiveUrl = media.getDeliveryUrl(asset.id, {
    width: 800,
    format: 'webp',
    quality: 85
  });

  return responsiveUrl;
}`,

    react: `// React / Next.js Component with Direct Upload
import { useState } from 'react';
import { MediaClient } from '@/lib/sdk/mediaClient';

const media = new MediaClient({ apiKey: '${displayKey}' });

export function MediaUploader({ onUploaded }) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(null);

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const asset = await media.upload(file, { visibility: 'public' });
      setPreview(asset.storage_url);
      if (onUploaded) onUploaded(asset);
    } catch (err) {
      alert('Upload failed: ' + err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="upload-box">
      <input type="file" onChange={handleFileSelect} disabled={uploading} />
      {uploading && <p>Uploading to Media Platform...</p>}
      {preview && <img src={preview} alt="Uploaded" className="h-32 rounded" />}
    </div>
  );
}`,

    curl: `# 1. List assets in current workspace
curl -X GET "http://localhost:3000/api/v1/assets?limit=10" \\
  -H "X-Media-Api-Key: ${displayKey}"

# 2. Upload an asset
curl -X POST "http://localhost:3000/api/v1/uploads" \\
  -H "X-Media-Api-Key: ${displayKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"original_filename":"hero.jpg","mime_type":"image/jpeg","size_bytes":102400,"visibility":"public"}'

# 3. Dynamic On-the-Fly Image Transformation (WebP, 600x400)
curl -X GET "http://localhost:3000/api/v1/delivery/med_example_id?w=600&h=400&format=webp&q=80" \\
  -H "X-Media-Api-Key: ${displayKey}" \\
  --output transformed.webp`,

    picker: `<!-- Embeddable Media Picker Popup in any Admin Panel / CMS -->
<button id="pickMediaBtn">Select from Media Platform</button>

<script>
  document.getElementById('pickMediaBtn').addEventListener('click', () => {
    const picker = window.open(
      'http://localhost:3000/picker?api_key=${displayKey}&mode=single',
      'MediaPicker',
      'width=1000,height=700'
    );

    // Listen for asset selection
    window.addEventListener('message', function onSelected(event) {
      if (event.data && event.data.type === 'MEDIA_ASSET_SELECTED') {
        const asset = event.data.asset;
        console.log('Selected Asset:', asset);
        document.getElementById('imageField').value = asset.storage_url;
        window.removeEventListener('message', onSelected);
      }
    });
  });
</script>`,
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(snippets[activeTab]);
    setCopied(true);
    toast.success('Code snippet copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-5 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-violet-400" />
            <h2 className="text-base font-semibold text-slate-100">Universal Project Integration</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Ready-to-use code templates for external apps, microservices, and admin panels.
          </p>
        </div>

        {/* API Key Selector */}
        {apiKeys.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Use Key:</span>
            <select
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-violet-300 font-mono focus:outline-none focus:border-violet-500 min-h-[44px]"
            >
              {apiKeys.map((k) => (
                <option key={k.id} value={k.key_prefix}>
                  {k.name} ({k.key_prefix}...)
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center justify-between border-b border-slate-800">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('node')}
            className={`flex items-center gap-1.5 py-2.5 px-3 text-xs font-semibold border-b-2 transition min-h-[44px] ${
              activeTab === 'node'
                ? 'border-violet-500 text-violet-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Code2 className="h-4 w-4" />
            <span>Node.js / SDK</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('react')}
            className={`flex items-center gap-1.5 py-2.5 px-3 text-xs font-semibold border-b-2 transition min-h-[44px] ${
              activeTab === 'react'
                ? 'border-violet-500 text-violet-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Globe className="h-4 w-4" />
            <span>React / Next.js</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('curl')}
            className={`flex items-center gap-1.5 py-2.5 px-3 text-xs font-semibold border-b-2 transition min-h-[44px] ${
              activeTab === 'curl'
                ? 'border-violet-500 text-violet-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Terminal className="h-4 w-4" />
            <span>cURL / REST</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('picker')}
            className={`flex items-center gap-1.5 py-2.5 px-3 text-xs font-semibold border-b-2 transition min-h-[44px] ${
              activeTab === 'picker'
                ? 'border-violet-500 text-violet-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ExternalLink className="h-4 w-4" />
            <span>Media Picker Widget</span>
          </button>
        </div>

        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition min-h-[44px]"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          <span>{copied ? 'Copied' : 'Copy Code'}</span>
        </button>
      </div>

      {/* Code Viewer */}
      <div className="relative rounded-xl bg-slate-950 border border-slate-800/80 p-4 font-mono text-xs text-slate-300 overflow-x-auto max-h-96">
        <pre>{snippets[activeTab]}</pre>
      </div>
    </div>
  );
}
