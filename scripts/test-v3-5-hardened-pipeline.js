const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

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

async function runV35Tests() {
  console.log('=== STARTING v3.5 HARDENED PIPELINE & PRIVATE DELIVERY TEST SUITE ===\n');

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

  // ----------------------------------------------------
  // STEP 1: Authentication & Client Setup
  // ----------------------------------------------------
  console.log('--- STEP 1: Authentication & Client Setup ---');
  let cookieHeader = '';
  try {
    const loginRes = await fetch(BASE_URL + '/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });
    assert(loginRes.ok, 'Admin authenticated successfully (HTTP ' + loginRes.status + ')');
    const setCookies = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [loginRes.headers.get('set-cookie')];
    cookieHeader = setCookies.map((c) => c?.split(';')[0]).filter(Boolean).join('; ');
  } catch (err) {
    assert(false, 'Admin login failed: ' + err.message);
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // ----------------------------------------------------
  // STEP 2: MediaWorkerCore Single Source of Truth
  // ----------------------------------------------------
  console.log('\n--- STEP 2: MediaWorkerCore Single Source of Truth ---');
  const { mediaWorkerCore, LeaseLostError, CANONICAL_LADDER } = require('../src/lib/media/workerCore');
  assert(typeof mediaWorkerCore.classifyError === 'function', 'mediaWorkerCore.classifyError exported');
  assert(typeof mediaWorkerCore.calculateNextAvailableAt === 'function', 'mediaWorkerCore.calculateNextAvailableAt exported');
  assert(typeof mediaWorkerCore.resolveLadderProfiles === 'function', 'mediaWorkerCore.resolveLadderProfiles exported');
  assert(typeof mediaWorkerCore.executePipeline === 'function', 'mediaWorkerCore.executePipeline exported');
  assert(CANONICAL_LADDER.length === 4, 'Canonical ladder has exactly 4 standardized profiles');

  // Verify Error Taxonomy
  const corErr = mediaWorkerCore.classifyError(new Error('moov atom not found'));
  assert(corErr.taxonomy === 'CORRUPTED_SOURCE' && corErr.isRetryable === false, 'CORRUPTED_SOURCE classified as non-retryable permanent error');

  const timeoutErr = mediaWorkerCore.classifyError(new Error('fetch failed: ETIMEDOUT'));
  assert(timeoutErr.taxonomy === 'STORAGE_TIMEOUT' && timeoutErr.isRetryable === true, 'STORAGE_TIMEOUT classified as retryable error');

  // Verify Backoff schedule
  const backoff1 = mediaWorkerCore.calculateNextAvailableAt(1);
  const diffSec = Math.round((new Date(backoff1).getTime() - Date.now()) / 1000);
  assert(diffSec >= 28 && diffSec <= 32, 'Attempt 1 backoff is ~30s (got: ' + diffSec + 's)');

  // ----------------------------------------------------
  // STEP 3: Atomic CAS Publish RPC & Fencing
  // ----------------------------------------------------
  console.log('\n--- STEP 3: Atomic CAS Publish RPC & Fencing ---');
  const testJobId = 'job_cas_' + Date.now().toString(36);
  const testAssetId = 'med_cas_' + Date.now().toString(36);
  const testWorkerId = 'worker_cas_valid';
  const testRunId = 'run_cas_123';
  const futureLease = new Date(Date.now() + 300000).toISOString();

  // Insert test asset with all required non-null fields
  const { error: aErr } = await supabase.from('assets').insert({
    id: testAssetId,
    workspace_id: 'ws_default',
    display_name: 'CAS Test Video',
    original_filename: 'cas_test.mp4',
    extension: 'mp4',
    asset_type: 'video',
    storage_key: 'test/cas.mp4',
    mime_type: 'video/mp4',
    size_bytes: 1000,
    processing_status: 'processing',
    visibility: 'public',
  });
  if (aErr) console.error('Asset insert error:', aErr);

  // Insert test processing job
  const { error: jErr } = await supabase.from('processing_jobs').insert({
    id: testJobId,
    asset_id: testAssetId,
    workspace_id: 'ws_default',
    job_type: 'video_transcode',
    status: 'processing',
    current_stage: 'transcoding',
    locked_by: testWorkerId,
    lease_expires_at: futureLease,
    job_run_id: testRunId,
  });
  if (jErr) console.error('Job insert error:', jErr);

  // Test 3A: Zombie worker with wrong workerId -> Must be rejected by CAS
  const { data: zombiePublished } = await supabase.rpc('publish_transcoded_asset', {
    p_job_id: testJobId,
    p_worker_id: 'worker_zombie_impostor',
    p_job_run_id: testRunId,
    p_output_version: 'v1_test',
    p_output_manifest: { test: true },
  });
  assert(zombiePublished === false, 'Zombie worker publish rejected by CAS (returns false)');

  // Test 3B: Valid worker with active lease -> Must succeed atomically
  const { data: validPublished, error: validErr } = await supabase.rpc('publish_transcoded_asset', {
    p_job_id: testJobId,
    p_worker_id: testWorkerId,
    p_job_run_id: testRunId,
    p_output_version: 'v1_cas_success',
    p_output_manifest: { master_m3u8: '#EXTM3U\n#EXT-X-VERSION:6' },
  });
  assert(!validErr && validPublished === true, 'Valid worker publish succeeded atomically via CAS RPC');

  // Verify asset was updated in the same atomic transaction
  const { data: updatedAsset } = await supabase.from('assets').select('*').eq('id', testAssetId).single();
  assert(updatedAsset?.processing_status === 'ready', 'Asset processing_status atomically updated to ready');
  assert(updatedAsset?.metadata_json?.active_output_version === 'v1_cas_success', 'Asset active_output_version atomically updated');

  // Clean up CAS test records
  await supabase.from('processing_jobs').delete().eq('id', testJobId);
  await supabase.from('assets').delete().eq('id', testAssetId);

  // ----------------------------------------------------
  // STEP 4: Private Delivery Policy & Signed URL Redirection
  // ----------------------------------------------------
  console.log('\n--- STEP 4: Private Delivery Policy & Signed URL Redirection ---');
  const privateAssetId = 'med_priv_' + Date.now().toString(36);
  await supabase.from('assets').insert({
    id: privateAssetId,
    workspace_id: 'ws_default',
    display_name: 'Confidential Executive Briefing',
    original_filename: 'confidential_briefing.mp4',
    extension: 'mp4',
    asset_type: 'video',
    storage_key: 'test/confidential.mp4',
    mime_type: 'video/mp4',
    size_bytes: 5000,
    processing_status: 'ready',
    visibility: 'private',
    metadata_json: {
      active_output_version: 'v1_priv',
      hls: {
        output_version: 'v1_priv',
        master_m3u8: '#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-STREAM-INF:BANDWIDTH=2700000,FRAME-RATE=30.000,RESOLUTION=1280x720\n720p.m3u8',
      },
    },
  });

  // Upload an actual segment chunk so createSignedUrl succeeds
  const segmentStorageKey = 'videos/' + privateAssetId + '/v1_priv/720p/000.ts';
  await supabase.storage.from(bucket).upload(
    segmentStorageKey,
    Buffer.from('G@..transport-stream-payload..'),
    { contentType: 'video/MP2T', upsert: true }
  );

  // 4A. Unauthenticated request to private master playlist -> Must be 401
  const unauthMasterRes = await fetch(BASE_URL + '/api/v1/delivery/video/' + privateAssetId + '/master.m3u8');
  assert(unauthMasterRes.status === 401, 'Unauthenticated GET private master.m3u8 returned HTTP 401 (got: ' + unauthMasterRes.status + ')');
  assert(unauthMasterRes.headers.get('www-authenticate')?.includes('Bearer'), 'Response includes WWW-Authenticate header');

  // 4B. Authenticated request to private master playlist -> Must be 200
  const authMasterRes = await fetch(BASE_URL + '/api/v1/delivery/video/' + privateAssetId + '/master.m3u8', {
    headers: { 'Cookie': cookieHeader },
  });
  assert(authMasterRes.status === 200, 'Authenticated GET private master.m3u8 returned HTTP 200 (got: ' + authMasterRes.status + ')');
  assert(authMasterRes.headers.get('cache-control')?.includes('private'), 'Private asset delivery sets Cache-Control: private, no-cache');

  // 4C. Unauthenticated request to private segment -> Must be 401
  const unauthSegRes = await fetch(BASE_URL + '/api/v1/delivery/video/' + privateAssetId + '/720p/000.ts', {
    redirect: 'manual',
  });
  assert(unauthSegRes.status === 401, 'Unauthenticated GET private segment returned HTTP 401 (got: ' + unauthSegRes.status + ')');

  // 4D. Authenticated request to private segment -> Must be 307 Redirect with Signed Download URL
  const authSegRes = await fetch(BASE_URL + '/api/v1/delivery/video/' + privateAssetId + '/720p/000.ts', {
    headers: { 'Cookie': cookieHeader },
    redirect: 'manual',
  });
  assert(authSegRes.status === 307, 'Authenticated GET private segment returned HTTP 307 Redirect (got: ' + authSegRes.status + ')');
  const segRedirectUrl = authSegRes.headers.get('location') || '';
  assert(segRedirectUrl.includes('token=') || segRedirectUrl.includes('sign') || segRedirectUrl.includes('supabase'), 'Segment redirect Location contains signed authorization token');

  // Clean up private test record & segment
  await supabase.storage.from(bucket).remove([segmentStorageKey]);
  await supabase.from('assets').delete().eq('id', privateAssetId);

  // ----------------------------------------------------
  // STEP 5: Synthetic Fallback Purged (No Fake 000.ts on Missing/Pending)
  // ----------------------------------------------------
  console.log('\n--- STEP 5: Synthetic Fallback Purged Verification ---');
  const pendingAssetId = 'med_pend_' + Date.now().toString(36);
  await supabase.from('assets').insert({
    id: pendingAssetId,
    workspace_id: 'ws_default',
    display_name: 'In Progress Encoding Video',
    original_filename: 'in_progress.mp4',
    extension: 'mp4',
    asset_type: 'video',
    storage_key: 'test/in_progress.mp4',
    mime_type: 'video/mp4',
    size_bytes: 2000,
    processing_status: 'processing',
    visibility: 'public',
  });

  const pendingVariantRes = await fetch(BASE_URL + '/api/v1/delivery/video/' + pendingAssetId + '/720p.m3u8');
  assert(pendingVariantRes.status === 425 || pendingVariantRes.status === 404, 'Pending asset variant returns HTTP 425/404 instead of synthetic fake playlist (got: ' + pendingVariantRes.status + ')');
  const pendingVariantBody = await pendingVariantRes.text();
  assert(!pendingVariantBody.includes('#EXTINF'), 'Pending variant playlist has NO fabricated #EXTINF segments');

  await supabase.from('assets').delete().eq('id', pendingAssetId);

  // ----------------------------------------------------
  // STEP 6: Normalized 30fps Frame Rate Verification
  // ----------------------------------------------------
  console.log('\n--- STEP 6: Normalized 30fps Frame Rate Verification ---');
  const engineSource = fs.readFileSync('src/lib/media/workerCore.js', 'utf8');
  assert(engineSource.includes("'-r', '30'"), 'WorkerCore explicitly forces -r 30 in FFmpeg transcoding arguments');
  assert(engineSource.includes('FRAME-RATE=30.000'), 'Master playlist strictly standardizes FRAME-RATE=30.000 across all renditions');

  console.log('\n==================================================');
  console.log('v3.5 HARDENED PIPELINE SUMMARY: ' + passed + ' PASSED | ' + failed + ' FAILED');
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runV35Tests().catch((err) => {
  console.error('Fatal error in test suite:', err);
  process.exit(1);
});
