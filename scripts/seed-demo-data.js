const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load .env.local
const envPath = path.resolve(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      let val = match[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[match[1].trim()] = val;
    }
  }
}

const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const salt = process.env.API_KEY_SECRET_SALT || 'dev_salt_antigravity_media_platform';

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Supabase credentials missing in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const DEMO_RAW_KEY = 'mda_live_demo2026_antigravity_platform_super_secret_key_v1';
const DEMO_KEY_PREFIX = 'mda_live_demo2026';
const DEMO_KEY_HASH = crypto.createHmac('sha256', salt).update(DEMO_RAW_KEY.trim()).digest('hex');

const DEMO_ASSETS = [
  {
    id: 'med_demo_nike_sneaker',
    workspace_id: 'ws_default',
    display_name: 'Nike Air Jordan Cyberpunk Edition',
    original_filename: 'nike-air-jordan-cyberpunk.jpg',
    asset_type: 'image',
    mime_type: 'image/jpeg',
    extension: 'jpg',
    size_bytes: 485200,
    width: 2400,
    height: 1600,
    storage_provider: 'supabase',
    storage_bucket: 'media-assets',
    storage_key: 'demo/nike-air-jordan.jpg',
    storage_url: 'https://images.unsplash.com/photo-1552346154-21d32810aba3?auto=format&fit=crop&w=1200&q=80',
    checksum_algorithm: 'md5',
    checksum: 'demo_checksum_nike_001',
    visibility: 'public',
    status: 'active',
    processing_status: 'ready',
    metadata_json: {
      tags: ['ecommerce', 'sneakers', 'product', 'fashion'],
      category: 'E-Commerce Products',
      alt: 'Nike Air Jordan modern studio shot',
    },
    created_at: '2026-09-08T18:00:00.000Z',
    updated_at: '2026-09-08T18:00:00.000Z',
  },
  {
    id: 'med_demo_smartwatch',
    workspace_id: 'ws_default',
    display_name: 'Minimalist Titanium Smartwatch',
    original_filename: 'titanium-smartwatch-white.jpg',
    asset_type: 'image',
    mime_type: 'image/jpeg',
    extension: 'jpg',
    size_bytes: 394100,
    width: 2000,
    height: 1500,
    storage_provider: 'supabase',
    storage_bucket: 'media-assets',
    storage_key: 'demo/titanium-smartwatch.jpg',
    storage_url: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=1200&q=80',
    checksum_algorithm: 'md5',
    checksum: 'demo_checksum_watch_002',
    visibility: 'public',
    status: 'active',
    processing_status: 'ready',
    metadata_json: {
      tags: ['watch', 'gadget', 'wearable', 'minimalist'],
      category: 'Electronics & Gadgets',
      alt: 'Smartwatch clean product photography',
    },
    created_at: '2026-09-08T18:05:00.000Z',
    updated_at: '2026-09-08T18:05:00.000Z',
  },
  {
    id: 'med_demo_modern_villa',
    workspace_id: 'ws_default',
    display_name: 'Nordic Modernist Concrete Villa',
    original_filename: 'nordic-concrete-villa.jpg',
    asset_type: 'image',
    mime_type: 'image/jpeg',
    extension: 'jpg',
    size_bytes: 684200,
    width: 2560,
    height: 1440,
    storage_provider: 'supabase',
    storage_bucket: 'media-assets',
    storage_key: 'demo/nordic-villa.jpg',
    storage_url: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80',
    checksum_algorithm: 'md5',
    checksum: 'demo_checksum_villa_003',
    visibility: 'public',
    status: 'active',
    processing_status: 'ready',
    metadata_json: {
      tags: ['architecture', 'real-estate', 'luxury', 'interior'],
      category: 'Architecture & Spaces',
      alt: 'Luxury Nordic Villa exterior at dusk',
    },
    created_at: '2026-09-08T18:10:00.000Z',
    updated_at: '2026-09-08T18:10:00.000Z',
  },
  {
    id: 'med_demo_tokyo_night',
    workspace_id: 'ws_default',
    display_name: 'Tokyo Shinjuku Neon Cyberpunk Nightscape',
    original_filename: 'tokyo-shinjuku-neon.jpg',
    asset_type: 'image',
    mime_type: 'image/jpeg',
    extension: 'jpg',
    size_bytes: 842100,
    width: 3840,
    height: 2160,
    storage_provider: 'supabase',
    storage_bucket: 'media-assets',
    storage_key: 'demo/tokyo-neon.jpg',
    storage_url: 'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?auto=format&fit=crop&w=1200&q=80',
    checksum_algorithm: 'md5',
    checksum: 'demo_checksum_tokyo_004',
    visibility: 'public',
    status: 'active',
    processing_status: 'ready',
    metadata_json: {
      tags: ['travel', 'tokyo', 'cyberpunk', 'neon', 'cityscape'],
      category: 'Cityscapes & Travel',
      alt: 'Tokyo illuminated streets in rain',
    },
    created_at: '2026-09-08T18:15:00.000Z',
    updated_at: '2026-09-08T18:15:00.000Z',
  },
  {
    id: 'med_demo_developer_workspace',
    workspace_id: 'ws_default',
    display_name: 'Clean Developer Desk & Mechanical Keyboard',
    original_filename: 'developer-minimal-workspace.jpg',
    asset_type: 'image',
    mime_type: 'image/jpeg',
    extension: 'jpg',
    size_bytes: 512400,
    width: 2880,
    height: 1800,
    storage_provider: 'supabase',
    storage_bucket: 'media-assets',
    storage_key: 'demo/developer-workspace.jpg',
    storage_url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80',
    checksum_algorithm: 'md5',
    checksum: 'demo_checksum_workspace_005',
    visibility: 'public',
    status: 'active',
    processing_status: 'ready',
    metadata_json: {
      tags: ['workspace', 'tech', 'developer', 'minimalism'],
      category: 'Workspaces',
      alt: 'Minimal workstation with warm lighting',
    },
    created_at: '2026-09-08T18:20:00.000Z',
    updated_at: '2026-09-08T18:20:00.000Z',
  },
  {
    id: 'med_demo_ai_neural_render',
    workspace_id: 'ws_default',
    display_name: 'Neural Network 3D Visual Flow',
    original_filename: 'neural-network-flow.jpg',
    asset_type: 'image',
    mime_type: 'image/jpeg',
    extension: 'jpg',
    size_bytes: 720300,
    width: 1920,
    height: 1080,
    storage_provider: 'supabase',
    storage_bucket: 'media-assets',
    storage_key: 'demo/neural-flow.jpg',
    storage_url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80',
    checksum_algorithm: 'md5',
    checksum: 'demo_checksum_neural_006',
    visibility: 'public',
    status: 'active',
    processing_status: 'ready',
    metadata_json: {
      tags: ['ai', 'abstract', 'generative', 'creative'],
      category: 'Abstract & Art',
      alt: 'Flowing abstract 3D wave ribbons',
    },
    created_at: '2026-09-08T18:25:00.000Z',
    updated_at: '2026-09-08T18:25:00.000Z',
  },
  {
    id: 'med_demo_camera_lens',
    workspace_id: 'ws_default',
    display_name: 'Cinema Prime Lens Optical Element',
    original_filename: 'cinema-prime-lens.jpg',
    asset_type: 'image',
    mime_type: 'image/jpeg',
    extension: 'jpg',
    size_bytes: 462100,
    width: 2400,
    height: 1600,
    storage_provider: 'supabase',
    storage_bucket: 'media-assets',
    storage_key: 'demo/cinema-lens.jpg',
    storage_url: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=1200&q=80',
    checksum_algorithm: 'md5',
    checksum: 'demo_checksum_lens_007',
    visibility: 'public',
    status: 'active',
    processing_status: 'ready',
    metadata_json: {
      tags: ['photography', 'camera', 'optics', 'cinema'],
      category: 'Electronics & Gadgets',
      alt: 'Professional camera glass reflections',
    },
    created_at: '2026-09-08T18:30:00.000Z',
    updated_at: '2026-09-08T18:30:00.000Z',
  },
  {
    id: 'med_demo_abstract_branding_vector',
    workspace_id: 'ws_default',
    display_name: 'MediaPlatform Geometric Brand Symbol',
    original_filename: 'brand-geometric-symbol.svg',
    asset_type: 'image',
    mime_type: 'image/svg+xml',
    extension: 'svg',
    size_bytes: 3420,
    width: 512,
    height: 512,
    storage_provider: 'supabase',
    storage_bucket: 'media-assets',
    storage_key: 'demo/brand-symbol.svg',
    storage_url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none"><rect width="512" height="512" rx="128" fill="%230F172A"/><path d="M128 256C128 185.31 185.31 128 256 128C326.69 128 384 185.31 384 256C384 326.69 326.69 384 256 384C185.31 384 128 326.69 128 256Z" stroke="%2338BDF8" stroke-width="24"/><path d="M220 180L340 256L220 332V180Z" fill="%2338BDF8"/><circle cx="256" cy="256" r="40" fill="%230284C7"/></svg>',
    checksum_algorithm: 'md5',
    checksum: 'demo_checksum_vector_008',
    visibility: 'public',
    status: 'active',
    processing_status: 'ready',
    metadata_json: {
      tags: ['vector', 'svg', 'branding', 'logo'],
      category: 'Brand Assets',
      alt: 'MediaPlatform SVG vector icon mark',
    },
    created_at: '2026-09-08T18:35:00.000Z',
    updated_at: '2026-09-08T18:35:00.000Z',
  },
  {
    id: 'med_demo_enterprise_spec_pdf',
    workspace_id: 'ws_default',
    display_name: 'Enterprise Media Platform Architecture Whitepaper 2026',
    original_filename: 'Enterprise-DAM-Whitepaper-2026.pdf',
    asset_type: 'document',
    mime_type: 'application/pdf',
    extension: 'pdf',
    size_bytes: 1845000,
    width: null,
    height: null,
    storage_provider: 'supabase',
    storage_bucket: 'media-assets',
    storage_key: 'demo/enterprise-whitepaper.pdf',
    storage_url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
    checksum_algorithm: 'md5',
    checksum: 'demo_checksum_pdf_009',
    visibility: 'public',
    status: 'active',
    processing_status: 'ready',
    metadata_json: {
      tags: ['whitepaper', 'specification', 'enterprise', 'pdf'],
      category: 'Documentation',
      pages: 28,
    },
    created_at: '2026-09-08T18:40:00.000Z',
    updated_at: '2026-09-08T18:40:00.000Z',
  },
  {
    id: 'med_demo_showcase_video',
    workspace_id: 'ws_default',
    display_name: 'Media Platform 4K Product Feature Cinematic Reel',
    original_filename: 'media-platform-4k-reel.mp4',
    asset_type: 'video',
    mime_type: 'video/mp4',
    extension: 'mp4',
    size_bytes: 14580000,
    duration_ms: 45000,
    width: 3840,
    height: 2160,
    storage_provider: 'supabase',
    storage_bucket: 'media-assets',
    storage_key: 'demo/product-reel.mp4',
    storage_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    checksum_algorithm: 'md5',
    checksum: 'demo_checksum_video_010',
    visibility: 'public',
    status: 'active',
    processing_status: 'ready',
    metadata_json: {
      tags: ['video', 'showcase', '4k', 'cinematic'],
      category: 'Showcase Videos',
      resolution: '4K UHD',
    },
    created_at: '2026-09-08T18:45:00.000Z',
    updated_at: '2026-09-08T18:45:00.000Z',
  },
];

async function seed() {
  console.log('🚀 SEEDING DEMO DATA & DEMO API KEY FOR LANDINGTEST...');

  // 1. Verify workspace 'ws_default'
  const { data: ws, error: wsErr } = await supabase
    .from('workspaces')
    .select('id, name')
    .eq('id', 'ws_default')
    .maybeSingle();

  if (wsErr || !ws) {
    console.log('  Creating default workspace ws_default...');
    await supabase.from('workspaces').upsert({
      id: 'ws_default',
      name: 'Production Media',
      slug: 'production',
      tier: 'enterprise',
      storage_limit_bytes: 107374182400,
      bandwidth_limit_bytes: 1099511627776,
    });
  }
  console.log('  ✅ Workspace ws_default verified');

  // 2. Get or create Service Account for workspace
  let { data: sa } = await supabase
    .from('service_accounts')
    .select('id')
    .eq('workspace_id', 'ws_default')
    .limit(1)
    .maybeSingle();

  if (!sa) {
    console.log('  Creating service account for Demo API Key...');
    const { data: newSa, error: saErr } = await supabase
      .from('service_accounts')
      .insert({
        id: 'sa_default_demo_2026',
        workspace_id: 'ws_default',
        name: 'Landing Demo Service Account',
        description: 'Service account for public demo landing page',
        status: 'active',
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (saErr) {
      console.warn('  ⚠️ Service account creation error:', saErr.message);
    }
    sa = newSa || { id: 'sa_default_demo_2026' };
  }
  console.log(`  ✅ Service Account ready: ${sa.id}`);

  // 3. Upsert Demo API Key
  const demoApiKeyRecord = {
    id: 'key_demo_landing_test_2026',
    workspace_id: 'ws_default',
    service_account_id: sa.id,
    name: 'Landing Demo Live Key (Full Access)',
    key_prefix: DEMO_KEY_PREFIX,
    key_hash: DEMO_KEY_HASH,
    scopes: ['*'],
    status: 'active',
    created_at: new Date().toISOString(),
  };

  const { error: keyErr } = await supabase
    .from('api_keys')
    .upsert(demoApiKeyRecord, { onConflict: 'id' });

  if (keyErr) {
    console.error('  ❌ Error upserting Demo API Key:', keyErr.message);
  } else {
    console.log('  ✅ Demo API Key configured:');
    console.log(`     Raw Key:    ${DEMO_RAW_KEY}`);
    console.log(`     Prefix:     ${DEMO_KEY_PREFIX}`);
    console.log(`     Scopes:     ['*']`);
  }

  // 4. Upsert Demo Assets
  console.log(`\n  Seeding ${DEMO_ASSETS.length} rich demo assets...`);
  for (const asset of DEMO_ASSETS) {
    const { error: assetErr } = await supabase
      .from('assets')
      .upsert(asset, { onConflict: 'id' });
    if (assetErr) {
      console.error(`  ⚠️ Failed to seed asset ${asset.id}: ${assetErr.message}`);
    } else {
      console.log(`  ✅ Seeded asset: [${asset.asset_type.toUpperCase()}] ${asset.display_name}`);
    }
  }

  console.log('\n🎉 DEMO SEEDING COMPLETED SUCCESSFULLY!');
}

seed().catch((err) => {
  console.error('Fatal seed error:', err);
  process.exit(1);
});
