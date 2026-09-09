/**
 * MediaPlatform Integration Demo Client (Node.js)
 * 
 * Script này mô phỏng cách một ứng dụng backend bên ngoài (ví dụ: E-commerce Server,
 * Mobile App Backend, CMS) kết nối và khai thác Media Platform thông qua REST API v1.
 */

const BASE_URL = process.env.MEDIA_PLATFORM_URL || 'http://localhost:3000';
const DEMO_API_KEY = process.env.MEDIA_API_KEY || 'mda_live_demo2026_antigravity_platform_super_secret_key_v1';

async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    'X-Media-Api-Key': DEMO_API_KEY,
    'X-Media-Api-Version': '2026-09-01',
    'Content-Type': 'application/json',
    ...options.headers,
  };

  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status} from ${endpoint}: ${errorText}`);
  }
  return response.json();
}

async function main() {
  console.log('===============================================================');
  console.log('🚀 DEMO TÍCH HỢP MEDIA PLATFORM TỪ ỨNG DỤNG NGOẠI VI (CLIENT SDK)');
  console.log('===============================================================');
  console.log(`Base URL:   ${BASE_URL}`);
  console.log(`Demo Key:   ${DEMO_API_KEY.slice(0, 20)}...`);

  // BƯỚC 1: Lấy danh mục Media với Sparse Fieldsets & Cursor
  console.log('\n--- BƯỚC 1: Lấy danh sách media (GET /api/v1/assets) ---');
  const listResult = await request('/api/v1/assets?limit=3&fields=id,display_name,asset_type,size_bytes');
  console.log(`✅ Lấy thành công ${listResult.data?.length} assets:`);
  listResult.data?.forEach((a, i) => {
    console.log(`   [${i + 1}] ID: ${a.id} | Name: "${a.display_name}" | Type: ${a.asset_type}`);
  });

  // BƯỚC 2: Batch Resolving API (Chống N+1 query)
  console.log('\n--- BƯỚC 2: Phân giải hàng loạt ảnh (POST /api/v1/assets/batch) ---');
  const sampleIds = listResult.data?.slice(0, 2).map((a) => a.id) || ['med_demo_nike_sneaker'];
  const batchResult = await request('/api/v1/assets/batch', {
    method: 'POST',
    body: JSON.stringify({
      ids: sampleIds,
      transform: { width: 600, format: 'webp', quality: 85 },
    }),
  });
  const batchAssets = Array.isArray(batchResult.data?.assets) ? batchResult.data.assets : (Array.isArray(batchResult.data) ? batchResult.data : []);
  console.log(`✅ Phân giải thành công ${batchAssets.length} items trong 1 HTTP request:`);
  batchAssets.forEach((item) => {
    console.log(`   • ${item.display_name}:`);
    console.log(`     Delivery URL: ${item.delivery_url}`);
  });

  // BƯỚC 3: Thử nghiệm tải ảnh chuyển đổi Dynamic CDN (Sharp Engine)
  console.log('\n--- BƯỚC 3: Kiểm tra tốc độ & ETag CDN (GET /api/v1/delivery/...) ---');
  const targetAssetId = 'med_demo_nike_sneaker';
  const deliveryUrl = `${BASE_URL}/api/v1/delivery/${targetAssetId}?w=300&format=webp&q=80`;
  const start = performance.now();
  const imgRes = await fetch(deliveryUrl);
  const elapsed = Math.round(performance.now() - start);

  console.log(`✅ Tải ảnh biến thể thành công trong ${elapsed}ms:`);
  console.log(`   • HTTP Status:    ${imgRes.status}`);
  console.log(`   • Content-Type:   ${imgRes.headers.get('content-type')}`);
  console.log(`   • ETag Caching:   ${imgRes.headers.get('etag')}`);
  console.log(`   • Cache-Control:  ${imgRes.headers.get('cache-control')}`);

  console.log('\n🎉 TOÀN BỘ CÁC BƯỚC TÍCH HỢP TỪ ỨNG DỤNG NGOÀI ĐÃ THÀNH CÔNG RỰC RỠ!');
  console.log('===============================================================\n');
}

main().catch((err) => {
  console.error('❌ Lỗi tích hợp:', err.message);
});
