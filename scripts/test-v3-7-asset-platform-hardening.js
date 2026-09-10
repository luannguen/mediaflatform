const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const sharp = require('sharp');

// 1. Load environment variables
if (fs.existsSync('.env.local')) {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
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

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const adminEmail = process.env.TEST_ADMIN_EMAIL || process.env.ADMIN_EMAIL;
const adminPassword = process.env.TEST_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;
const workerToken = process.env.WORKER_SERVICE_TOKEN;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'media-assets';

async function runTestSuite() {
  console.log('================================================================');
  console.log('  MEDIA PLATFORM v3.7 — ASSET PLATFORM HARDENING TEST SUITE     ');
  console.log('  P0 Security & Cache • P1 Image • P2 Document • P3 Integrity   ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log('  ✅ PASS: ' + message);
      passed++;
    } else {
      console.error('  ❌ FAIL: ' + message);
      failed++;
    }
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // -------------------------------------------------------------
  // STEP 1: Admin Authentication & Session
  // -------------------------------------------------------------
  console.log('--- STEP 1: Authentication & Setup ---');
  const loginRes = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  assert(loginRes.ok, `Admin login successful (HTTP ${loginRes.status})`);
  const setCookies = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [loginRes.headers.get('set-cookie')];
  const adminCookie = setCookies.map((c) => c?.split(';')[0]).filter(Boolean).join('; ');
  const loginJson = await loginRes.json();
  const workspaceId = loginJson.data?.workspace?.id || loginJson.data?.user?.workspace_id || 'ws_default';
  assert(!!workspaceId, `Resolved Admin workspace ID: ${workspaceId}`);

  const authHeaders = {
    Cookie: adminCookie,
    'X-Workspace-Id': workspaceId,
  };

  // -------------------------------------------------------------
  // STEP 2: P0 Security — Delivery Cache Hardening (Private Assets)
  // -------------------------------------------------------------
  console.log('\n--- STEP 2: P0 Delivery Cache Hardening (Private vs Public) ---');
  // Create a private asset fixture
  const privateAssetId = `med_priv_${Date.now().toString(36)}`;
  const privateKey = `images/${privateAssetId}/source.png`;
  const imgBuffer = await sharp({
    create: { width: 400, height: 300, channels: 4, background: { r: 59, g: 130, b: 246, alpha: 1 } },
  }).png().toBuffer();

  await supabase.storage.from(bucket).upload(privateKey, imgBuffer, { contentType: 'image/png', upsert: true });

  const { error: insErr } = await supabase.from('assets').insert({
    id: privateAssetId,
    workspace_id: workspaceId,
    asset_type: 'image',
    original_filename: 'private_secret.png',
    display_name: 'Private Secret',
    mime_type: 'image/png',
    extension: 'png',
    size_bytes: imgBuffer.length,
    storage_provider: 'supabase',
    storage_bucket: bucket,
    storage_key: privateKey,
    visibility: 'private',
    status: 'active',
    processing_status: 'ready',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  assert(!insErr, `Private asset inserted into DB: ${insErr ? insErr.message : 'OK'}`);

  // Test 2.1: Private asset delivery receives private no-store cache header
  const privRes = await fetch(`${BASE_URL}/api/v1/delivery/${privateAssetId}`, {
    headers: authHeaders,
  });
  assert(privRes.status === 200, `Private asset delivery returns HTTP 200 (Got ${privRes.status})`);
  const privCache = privRes.headers.get('cache-control') || '';
  assert(
    privCache.includes('private') && privCache.includes('no-store') && !privCache.includes('public') && !privCache.includes('immutable'),
    `Private delivery Cache-Control is strictly private & non-cachable: "${privCache}"`
  );

  // Test 2.2: Conditional 304 response also retains strict private header
  const etag = privRes.headers.get('etag');
  if (etag) {
    const condRes = await fetch(`${BASE_URL}/api/v1/delivery/${privateAssetId}`, {
      headers: { ...authHeaders, 'If-None-Match': etag },
    });
    assert(condRes.status === 304, `Conditional request returns HTTP 304 Not Modified`);
    const condCache = condRes.headers.get('cache-control') || '';
    assert(
      condCache.includes('private') && !condCache.includes('public'),
      `Conditional 304 Cache-Control strictly retains private header: "${condCache}"`
    );
  } else {
    assert(false, 'ETag was missing on private asset delivery');
  }

  // -------------------------------------------------------------
  // STEP 3: P0 Security — Worker Service Scope Hardening
  // -------------------------------------------------------------
  console.log('\n--- STEP 3: P0 Worker Identity Scope Hardening ---');
  // Worker token should be FORBIDDEN on consumer/user asset APIs
  const workerHeaders = {
    Authorization: `Bearer ${workerToken}`,
    'X-Workspace-Id': workspaceId,
  };

  const workerDeliveryRes = await fetch(`${BASE_URL}/api/v1/delivery/${privateAssetId}`, {
    headers: workerHeaders,
  });
  assert(
    workerDeliveryRes.status === 403,
    `Worker token is strictly FORBIDDEN from delivery API (Got HTTP ${workerDeliveryRes.status})`
  );

  const workerAssetPatchRes = await fetch(`${BASE_URL}/api/v1/assets/${privateAssetId}`, {
    method: 'PATCH',
    headers: { ...workerHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ display_name: 'Hacked by Worker' }),
  });
  assert(
    workerAssetPatchRes.status === 403,
    `Worker token is strictly FORBIDDEN from Asset PATCH API (Got HTTP ${workerAssetPatchRes.status})`
  );

  // -------------------------------------------------------------
  // STEP 4: P0 Security — Decompression Bomb Prevention
  // -------------------------------------------------------------
  console.log('\n--- STEP 4: P0 Decompression Bomb Prevention ---');
  const bombRes = await fetch(`${BASE_URL}/api/v1/delivery/${privateAssetId}?w=10000&h=10000`, {
    headers: authHeaders,
  });
  assert(bombRes.status === 400, `Excessive dimension request rejected with HTTP 400 (Got ${bombRes.status})`);
  const bombJson = await bombRes.json();
  assert(
    bombJson.error === 'IMAGE_DIMENSION_LIMIT_EXCEEDED' || bombJson.error === 'DECOMPRESSION_BOMB_PREVENTED',
    `Decompression bomb blocked with specific error: ${bombJson.error}`
  );

  // -------------------------------------------------------------
  // STEP 5: P0 Security — Asset PATCH DTO Whitelist
  // -------------------------------------------------------------
  console.log('\n--- STEP 5: P0 Asset PATCH DTO Whitelist ---');
  // Attempt to mutate immutable fields: storage_key, workspace_id
  const mutateKeyRes = await fetch(`${BASE_URL}/api/v1/assets/${privateAssetId}`, {
    method: 'PATCH',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ storage_key: 'malicious/path.png' }),
  });
  assert(mutateKeyRes.status === 400, `Attempt to mutate storage_key rejected with HTTP 400 (Got ${mutateKeyRes.status})`);
  const mutateKeyJson = await mutateKeyRes.json();
  const mutateErrorCode = mutateKeyJson.error?.code || mutateKeyJson.error;
  assert(
    mutateErrorCode === 'IMMUTABLE_FIELD_MUTATION',
    `Immutable field mutation blocked with code: ${mutateErrorCode}`
  );

  // Valid PATCH should succeed
  const validPatchRes = await fetch(`${BASE_URL}/api/v1/assets/${privateAssetId}`, {
    method: 'PATCH',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ display_name: 'Safe Renamed Title', description: 'Updated description' }),
  });
  assert(validPatchRes.status === 200, `Valid metadata PATCH succeeded with HTTP 200`);
  const validJson = await validPatchRes.json();
  assert(validJson.data?.display_name === 'Safe Renamed Title', `Display name updated successfully`);

  // -------------------------------------------------------------
  // STEP 6: P0 Security — Binary Magic Byte & MIME Spoofing
  // -------------------------------------------------------------
  console.log('\n--- STEP 6: P0 Binary Magic Byte & MIME Spoofing Detection ---');
  // Step 6.1: Client declares image/jpeg, but uploads executable binary or text
  const presignedSpoofRes = await fetch(`${BASE_URL}/api/v1/uploads/presigned`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: 'innocent_photo.jpg', mime_type: 'image/jpeg', size_bytes: 100 }),
  });
  assert(presignedSpoofRes.status === 201, `Presigned upload created for test`);
  const spoofSession = (await presignedSpoofRes.json()).data;

  // Upload malicious executable bytes (MZ header: 4D 5A) to storage key
  const exeBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
  await supabase.storage.from(bucket).upload(spoofSession.storage_key, exeBuffer, {
    contentType: 'image/jpeg',
    upsert: true,
  });

  // Confirm upload should detect MIME spoofing and reject
  const confirmSpoofRes = await fetch(`${BASE_URL}/api/v1/uploads/confirm`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ asset_id: spoofSession.asset_id }),
  });
  assert(confirmSpoofRes.status === 400, `MIME spoof confirm rejected with HTTP 400 (Got ${confirmSpoofRes.status})`);
  const spoofJson = await confirmSpoofRes.json();
  const spoofErrorCode = spoofJson.error?.code || spoofJson.error;
  assert(
    spoofErrorCode === 'UPLOAD_CONTENT_TYPE_MISMATCH',
    `MIME spoofing blocked with error UPLOAD_CONTENT_TYPE_MISMATCH (Got: ${spoofErrorCode})`
  );

  // Step 6.2: Archive upload enters quarantined status
  const presignedZipRes = await fetch(`${BASE_URL}/api/v1/uploads/presigned`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: 'bundle.zip', mime_type: 'application/zip', size_bytes: 50 }),
  });
  const zipSession = (await presignedZipRes.json()).data;
  const zipBuffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]); // PK\x03\x04
  await supabase.storage.from(bucket).upload(zipSession.storage_key, zipBuffer, {
    contentType: 'application/zip',
    upsert: true,
  });

  const confirmZipRes = await fetch(`${BASE_URL}/api/v1/uploads/confirm`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ asset_id: zipSession.asset_id }),
  });
  assert(confirmZipRes.status === 200, `Archive upload confirmed`);
  const zipAsset = (await confirmZipRes.json()).data;
  assert(zipAsset.status === 'quarantined', `Archive asset automatically assigned status: 'quarantined'`);

  // Direct delivery of quarantined asset must be blocked
  const quarDeliveryRes = await fetch(`${BASE_URL}/api/v1/delivery/${zipAsset.id}`, {
    headers: authHeaders,
  });
  assert(
    quarDeliveryRes.status === 403,
    `Delivery of quarantined asset blocked with HTTP 403 (Got ${quarDeliveryRes.status})`
  );

  // -------------------------------------------------------------
  // STEP 7: P1 Image Processing Pipeline & Canonical Variants
  // -------------------------------------------------------------
  console.log('\n--- STEP 7: P1 Real Image Processing Pipeline & Canonical Ladder ---');
  // Create genuine 1000x800 image
  const genuineImage = await sharp({
    create: { width: 1000, height: 800, channels: 3, background: { r: 239, g: 68, b: 68 } },
  }).jpeg({ quality: 90 }).toBuffer();

  const presignedImgRes = await fetch(`${BASE_URL}/api/v1/uploads/presigned`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: 'landscape.jpg', mime_type: 'image/jpeg', size_bytes: genuineImage.length }),
  });
  const imgSession = (await presignedImgRes.json()).data;

  await supabase.storage.from(bucket).upload(imgSession.storage_key, genuineImage, {
    contentType: 'image/jpeg',
    upsert: true,
  });

  const confirmImgRes = await fetch(`${BASE_URL}/api/v1/uploads/confirm`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ asset_id: imgSession.asset_id }),
  });
  assert(confirmImgRes.status === 200, `Genuine image upload confirmed`);
  const confirmedImg = (await confirmImgRes.json()).data;
  assert(confirmedImg.processing_status === 'pending', `Image processing_status initialized as 'pending'`);
  assert(!!confirmedImg.job_id, `Image optimization job enqueued: ${confirmedImg.job_id}`);

  // Process the image job via HTTP Worker Trigger
  console.log(`  Processing image job ${confirmedImg.job_id}...`);
  const processJobRes = await fetch(`${BASE_URL}/api/v1/jobs/process`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${workerToken}`,
      'X-Worker-Id': 'test_runner_worker',
    },
    body: JSON.stringify({ worker_id: 'test_runner_worker' }),
  });
  assert(processJobRes.status === 200, `Worker process endpoint executed successfully`);

  // Verify asset is now ready and output version is assigned
  const { data: updatedImgAsset } = await supabase.from('assets').select('*').eq('id', imgSession.asset_id).single();
  assert(updatedImgAsset.processing_status === 'ready', `Asset processing_status transitioned to 'ready'`);
  const outVer = updatedImgAsset.metadata_json?.active_output_version;
  assert(!!outVer, `Asset has active_output_version: ${outVer}`);

  // Verify canonical variants in asset_variants table (Non-upscaling: 1000px source -> thumb(160), small(320), medium(768). large(1280) and xlarge(1920) must NOT be generated)
  const { data: variants } = await supabase.from('asset_variants').select('*').eq('asset_id', imgSession.asset_id);
  assert(Array.isArray(variants) && variants.length === 3, `Strict Non-Upscaling: Exactly 3 variants generated (thumb, small, medium). Large & xlarge omitted.`);
  const variantNames = (variants || []).map((v) => v.variant_name);
  assert(
    variantNames.includes('thumb') && variantNames.includes('small') && variantNames.includes('medium') && !variantNames.includes('large'),
    `Canonical profiles verified: [${variantNames.join(', ')}]`
  );

  // Verify palette extracted
  const palette = updatedImgAsset.metadata_json?.image?.palette;
  assert(palette && Array.isArray(palette.colors) && palette.colors.length === 5, `Dominant 5-color palette extracted`);

  // Verify Canonical Variant Delivery Cache Hit
  const canonicalDelivRes = await fetch(`${BASE_URL}/api/v1/delivery/${imgSession.asset_id}?w=320&format=webp`, {
    headers: authHeaders,
  });
  assert(canonicalDelivRes.status === 200, `Canonical variant delivery returns HTTP 200`);
  const transformHeader = canonicalDelivRes.headers.get('x-media-transform');
  assert(
    transformHeader === 'hit-canonical-variant',
    `Pre-rendered canonical variant hit: X-Media-Transform="${transformHeader}"`
  );

  // Verify On-Demand Transform Caching
  const customDelivRes1 = await fetch(`${BASE_URL}/api/v1/delivery/${imgSession.asset_id}?w=450&format=webp`, {
    headers: authHeaders,
  });
  assert(customDelivRes1.status === 200, `Custom transform on-demand served`);

  // Second fetch of custom transform should hit transform disk cache
  await new Promise((r) => setTimeout(r, 500));
  const customDelivRes2 = await fetch(`${BASE_URL}/api/v1/delivery/${imgSession.asset_id}?w=450&format=webp`, {
    headers: authHeaders,
  });
  const customTransformHeader = customDelivRes2.headers.get('x-media-transform');
  assert(
    customTransformHeader === 'hit-transform-cache' || customTransformHeader === 'hit-etag-cache',
    `Deterministic transform cache hit: X-Media-Transform="${customTransformHeader}"`
  );

  // -------------------------------------------------------------
  // STEP 8: P2 Document Processing Pipeline
  // -------------------------------------------------------------
  console.log('\n--- STEP 8: P2 Document Pipeline & PDF Processing ---');
  // Construct minimal valid PDF binary
  const pdfContent = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R >> endobj
4 0 obj << /Type /Page /Parent 2 0 R >> endobj
xref
0 5
trailer << /Root 1 0 R >>
%%EOF`;
  const pdfBuffer = Buffer.from(pdfContent, 'latin1');

  const presignedDocRes = await fetch(`${BASE_URL}/api/v1/uploads/presigned`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: 'contract.pdf', mime_type: 'application/pdf', size_bytes: pdfBuffer.length }),
  });
  const docSession = (await presignedDocRes.json()).data;

  await supabase.storage.from(bucket).upload(docSession.storage_key, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: true,
  });

  const confirmDocRes = await fetch(`${BASE_URL}/api/v1/uploads/confirm`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ asset_id: docSession.asset_id }),
  });
  const confirmDocBody = await confirmDocRes.json();
  if (confirmDocRes.status !== 200) {
    console.error('confirmDocRes failed:', confirmDocRes.status, confirmDocBody);
  }
  assert(confirmDocRes.status === 200, `PDF document confirmed`);
  const confirmedDoc = confirmDocBody.data;
  assert(confirmedDoc.processing_status === 'pending', `Document processing_status is 'pending'`);
  assert(!!confirmedDoc.job_id, `Document extraction job enqueued: ${confirmedDoc.job_id}`);

  // Process Document Job
  await fetch(`${BASE_URL}/api/v1/jobs/process`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${workerToken}`,
      'X-Worker-Id': 'test_runner_worker',
    },
    body: JSON.stringify({ worker_id: 'test_runner_worker' }),
  });

  const { data: updatedDocAsset } = await supabase.from('assets').select('*').eq('id', docSession.asset_id).single();
  assert(updatedDocAsset.processing_status === 'ready', `Document processed to 'ready'`);
  assert(updatedDocAsset.metadata_json?.document?.page_count === 2, `PDF inspected exactly 2 pages`);
  assert(!!updatedDocAsset.metadata_json?.document?.thumbnail_key, `PDF generated first-page WebP thumbnail`);

  // Document thumbnail delivery
  const docThumbRes = await fetch(`${BASE_URL}/api/v1/delivery/${docSession.asset_id}?thumbnail=true`, {
    headers: authHeaders,
  });
  assert(docThumbRes.status === 200, `Document thumbnail delivered with HTTP 200`);
  assert(docThumbRes.headers.get('content-type')?.includes('image/webp'), `Thumbnail format is image/webp`);

  // -------------------------------------------------------------
  // STEP 9: P3 Transactional Reference Sync & Graph Purge
  // -------------------------------------------------------------
  console.log('\n--- STEP 9: P3 Reference Sync & Comprehensive Graph Purge ---');
  // Sync references via API
  const refSyncRes = await fetch(`${BASE_URL}/api/v1/references/sync`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_app: 'ecommerce_web',
      entity_type: 'product',
      entity_id: 'prod_9999',
      references: [
        { asset_id: imgSession.asset_id, field_name: 'hero_image' },
        { asset_id: docSession.asset_id, field_name: 'manual_pdf' },
      ],
    }),
  });
  assert(refSyncRes.status === 200, `Transactional reference sync successful (HTTP 200)`);
  const refSyncJson = await refSyncRes.json();
  assert(refSyncJson.data?.count === 2, `Synchronized exactly 2 entity references`);

  // Attempting safe delete on referenced image should be BLOCKED with 409 ASSET_IN_USE
  const blockedDeleteRes = await fetch(`${BASE_URL}/api/v1/assets/${imgSession.asset_id}?action=purge`, {
    method: 'DELETE',
    headers: authHeaders,
  });
  assert(
    blockedDeleteRes.status === 409,
    `Safe delete blocked when active references exist (HTTP 409 ASSET_IN_USE)`
  );
  const blockedJson = await blockedDeleteRes.json();
  const blockedErrorCode = blockedJson.error?.code || blockedJson.error;
  assert(blockedErrorCode === 'ASSET_IN_USE', `Error code verified: ASSET_IN_USE`);

  // Force Purge permanently cleans entire artifact graph (original, variants, transforms, DB records)
  const forcePurgeRes = await fetch(`${BASE_URL}/api/v1/assets/${imgSession.asset_id}?action=purge&force=true`, {
    method: 'DELETE',
    headers: authHeaders,
  });
  assert(forcePurgeRes.status === 200, `Force purge completed with HTTP 200`);
  const purgeJson = await forcePurgeRes.json();
  assert(purgeJson.data?.success === true, `Artifact graph purge reported success`);

  // Verify DB record is gone
  const { data: checkDeleted } = await supabase.from('assets').select('id').eq('id', imgSession.asset_id).maybeSingle();
  assert(!checkDeleted, `Asset record completely removed from database`);

  // Verify variants are gone
  const { data: checkVariants } = await supabase.from('asset_variants').select('id').eq('asset_id', imgSession.asset_id);
  assert(!checkVariants || checkVariants.length === 0, `All asset variants purged from database`);

  // Verify references are cleaned
  const { data: checkRefs } = await supabase.from('asset_references').select('id').eq('asset_id', imgSession.asset_id);
  assert(!checkRefs || checkRefs.length === 0, `Stale references removed from database`);

  // Idempotency check: Purging already purged asset returns success
  const secondPurgeRes = await fetch(`${BASE_URL}/api/v1/assets/${imgSession.asset_id}?action=purge&force=true`, {
    method: 'DELETE',
    headers: authHeaders,
  });
  // 404 is also valid if asset doesn't exist, but service idempotency returns clean response
  assert(secondPurgeRes.status === 404 || secondPurgeRes.status === 200, `Idempotent purge check completed`);

  // -------------------------------------------------------------
  // Clean up remaining test fixtures
  // -------------------------------------------------------------
  await fetch(`${BASE_URL}/api/v1/assets/${privateAssetId}?action=purge&force=true`, { method: 'DELETE', headers: authHeaders });
  await fetch(`${BASE_URL}/api/v1/assets/${docSession.asset_id}?action=purge&force=true`, { method: 'DELETE', headers: authHeaders });
  await fetch(`${BASE_URL}/api/v1/assets/${zipSession.asset_id}?action=purge&force=true`, { method: 'DELETE', headers: authHeaders });

  console.log('\n================================================================');
  console.log(`  TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
