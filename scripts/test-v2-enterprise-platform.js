const http = require('http');

const BASE_URL = 'http://localhost:3000';
const DEMO_API_KEY = 'mda_live_demo2026_antigravity_platform_super_secret_key_v1';

async function request(path, options = {}) {
  const url = new URL(path, BASE_URL);
  return new Promise((resolve, reject) => {
    const headers = {
      'X-Media-Api-Key': DEMO_API_KEY,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };

    const req = http.request(
      url,
      {
        method: options.method || 'GET',
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const bodyBuffer = Buffer.concat(chunks);
          let json = null;
          const contentType = res.headers['content-type'] || '';
          if (contentType.includes('application/json')) {
            try {
              json = JSON.parse(bodyBuffer.toString('utf8'));
            } catch (e) {}
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: bodyBuffer,
            json,
          });
        });
      }
    );

    req.on('error', reject);

    if (options.body) {
      if (typeof options.body === 'string' || Buffer.isBuffer(options.body)) {
        req.write(options.body);
      } else {
        req.write(JSON.stringify(options.body));
      }
    }
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('🧪 ENTERPRISE MEDIA PLATFORM V2.0 - INTEGRATION TEST SUITE');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  try {
    // -------------------------------------------------------------
    // Test Group 1: Direct-to-Storage Presigned Uploads
    // -------------------------------------------------------------
    console.log('📦 GROUP 1: DIRECT-TO-STORAGE PRESIGNED UPLOADS');

    const presignedRes = await request('/api/v1/uploads/presigned', {
      method: 'POST',
      body: {
        filename: 'v2_enterprise_banner.png',
        mime_type: 'image/png',
        size_bytes: 1048576,
        visibility: 'workspace',
      },
    });

    assert(presignedRes.status === 201, `POST /api/v1/uploads/presigned returned HTTP 201 (Got: ${presignedRes.status})`);
    const presignedData = presignedRes.json?.data;
    assert(presignedData && presignedData.asset_id && presignedData.asset_id.startsWith('med_'), `Asset ID generated with med_ prefix: ${presignedData?.asset_id}`);
    assert(presignedData && Boolean(presignedData.upload_url), `Direct upload URL generated: ${presignedData?.upload_url?.slice(0, 50)}...`);
    assert(presignedData && presignedData.method === 'PUT', `Upload method is PUT`);
    assert(presignedData && presignedData.expires_in > 0, `Upload URL has valid expiration: ${presignedData?.expires_in}s`);

    const createdAssetId = presignedData.asset_id;

    // Confirm direct upload
    const confirmRes = await request('/api/v1/uploads/confirm', {
      method: 'POST',
      body: {
        asset_id: createdAssetId,
        width: 1920,
        height: 1080,
      },
    });

    assert(confirmRes.status === 200, `POST /api/v1/uploads/confirm returned HTTP 200 (Got: ${confirmRes.status})`);
    const confirmedAsset = confirmRes.json?.data?.asset || confirmRes.json?.data;
    assert(confirmedAsset && confirmedAsset.status === 'active', `Confirmed asset status is 'active' (Got: ${confirmedAsset?.status})`);
    assert(confirmedAsset && confirmedAsset.processing_status === 'ready', `Confirmed asset processing_status is 'ready'`);

    // -------------------------------------------------------------
    // Test Group 2: In-Place Asset Versioning & Rollback
    // -------------------------------------------------------------
    console.log('\n🔄 GROUP 2: IN-PLACE ASSET VERSIONING & ROLLBACK');

    // Create a new version of the asset
    const replaceRes = await request(`/api/v1/assets/${createdAssetId}/versions`, {
      method: 'POST',
      body: {
        storage_key: `uploads/ws_default/v2_updated_banner.png`,
        storage_url: confirmedAsset.storage_url,
        mime_type: 'image/png',
        size_bytes: 1200000,
        width: 2560,
        height: 1440,
        comment: 'Rebrand with new 2K typography',
      },
    });

    assert(replaceRes.status === 201, `POST /api/v1/assets/:id/versions returned HTTP 201`);
    const versionData = replaceRes.json?.data;
    assert(versionData && versionData.versionNumber === 2, `Version number incremented to 2 (Got: ${versionData?.versionNumber})`);
    assert(versionData && versionData.asset.id === createdAssetId, `CRITICAL: Asset ID strictly preserved unchanged (${versionData?.asset?.id})`);
    assert(versionData && versionData.archivedVersion && versionData.archivedVersion.version_number === 1, `Previous version archived with version_number: 1`);

    // List versions
    const listVersionsRes = await request(`/api/v1/assets/${createdAssetId}/versions`);
    assert(listVersionsRes.status === 200, `GET /api/v1/assets/:id/versions returned HTTP 200`);
    const versionsList = listVersionsRes.json?.data || [];
    assert(Array.isArray(versionsList) && versionsList.length >= 1, `Version history has recorded archived versions (Count: ${versionsList.length})`);

    // Rollback to version 1
    const rollbackRes = await request(`/api/v1/assets/${createdAssetId}/rollback`, {
      method: 'POST',
      body: {
        version_number: 1,
      },
    });

    assert(rollbackRes.status === 200, `POST /api/v1/assets/:id/rollback returned HTTP 200`);
    assert(rollbackRes.json?.data?.asset?.id === createdAssetId, `Rollback preserved original asset ID`);

    // -------------------------------------------------------------
    // Test Group 3: Sharp CDN Enhancements (Smart Crop & Watermark)
    // -------------------------------------------------------------
    console.log('\n⚡ GROUP 3: SHARP CDN ENGINE (SMART CROP & WATERMARK)');

    // Use pre-existing sample asset for transformation test
    const sampleAssetId = 'med_demo_nike_sneaker';

    // 1. Smart Crop delivery
    const smartCropRes = await request(`/api/v1/delivery/${sampleAssetId}?w=320&h=320&fit=smart&format=webp`);
    assert(smartCropRes.status === 200, `GET /delivery/:id?fit=smart returned HTTP 200`);
    assert(smartCropRes.headers['content-type'] === 'image/webp', `Content-Type is image/webp (Got: ${smartCropRes.headers['content-type']})`);
    assert(smartCropRes.headers['x-media-transform'] === 'sharp-smart-crop', `Transformation header confirms Smart Crop: ${smartCropRes.headers['x-media-transform']}`);
    const etag1 = smartCropRes.headers['etag'];
    assert(Boolean(etag1), `Deterministic ETag provided: ${etag1}`);

    // 2. Dynamic Watermark delivery
    const watermarkRes = await request(`/api/v1/delivery/${sampleAssetId}?w=320&fit=smart&watermark=EnterpriseV2&format=webp`);
    assert(watermarkRes.status === 200, `GET /delivery/:id with dynamic watermark returned HTTP 200`);
    const etagWatermark = watermarkRes.headers['etag'];
    assert(etagWatermark !== etag1, `ETag changes deterministically when watermark is applied`);

    // 3. ETag Conditional Request (304 Not Modified)
    const cachedRes = await request(`/api/v1/delivery/${sampleAssetId}?w=320&h=320&fit=smart&format=webp`, {
      headers: {
        'If-None-Match': etag1,
      },
    });
    assert(cachedRes.status === 304, `Conditional request with If-None-Match returned HTTP 304 Not Modified`);
    assert(cachedRes.headers['x-media-transform'] === 'hit-etag-cache', `Cache hit confirmed by X-Media-Transform header`);

    // -------------------------------------------------------------
    // Test Group 4: Analytics API & Telemetry
    // -------------------------------------------------------------
    console.log('\n📊 GROUP 4: REAL-TIME ANALYTICS & OBSERVABILITY');

    const analyticsRes = await request('/api/v1/analytics?period=24h');
    assert(analyticsRes.status === 200, `GET /api/v1/analytics returned HTTP 200`);
    const analytics = analyticsRes.json?.data;
    assert(typeof analytics?.totalRequests === 'number' && analytics.totalRequests >= 0, `Total requests tracked: ${analytics?.totalRequests}`);
    assert(typeof analytics?.cacheHitRate === 'number', `Cache hit rate computed: ${analytics?.cacheHitRate}%`);
    assert(typeof analytics?.bandwidthSavedPercent === 'number', `Bandwidth savings computed: ${analytics?.bandwidthSavedPercent}%`);
    assert(Array.isArray(analytics?.formatBreakdown), `Format breakdown array returned`);
    assert(Array.isArray(analytics?.topAssets), `Top media assets array returned`);
    assert(Array.isArray(analytics?.recentEvents), `Recent live delivery events returned`);

    // -------------------------------------------------------------
    // Summary
    // -------------------------------------------------------------
    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log(`🏁 TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
    console.log('═══════════════════════════════════════════════════════════════════');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error('💥 Unexpected test exception:', error);
    process.exit(1);
  }
}

runTests();
