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

function buildAssetFixture(id, workspaceId, visibility, processingStatus) {
  const now = new Date().toISOString();
  return {
    id,
    workspace_id: workspaceId,
    asset_type: 'video',
    original_filename: 'test_sample.mp4',
    display_name: 'Test Sample Video',
    mime_type: 'video/mp4',
    extension: 'mp4',
    size_bytes: 1048576,
    storage_provider: 'supabase',
    storage_bucket: 'media-assets',
    storage_key: 'videos/' + id + '/raw.mp4',
    checksum_algorithm: 'sha256',
    checksum: 'mock_checksum_' + id,
    visibility: visibility,
    status: 'active',
    processing_status: processingStatus,
    created_at: now,
    updated_at: now,
  };
}

async function runV36Tests() {
  console.log('=== STARTING v3.6 RESILIENT QUEUE, FENCING & MULTI-TENANT TEST SUITE ===\n');

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
  // STEP 2: Retry Backoff Invariant (available_at, no hot loop)
  // ----------------------------------------------------
  console.log('\n--- STEP 2: Retry Backoff Invariant (available_at, no hot loop) ---');
  const testRetryAssetId = 'med_v36_retry_' + Date.now();
  const testRetryJobId = 'job_v36_retry_' + Date.now();
  const workerA = 'w_test_worker_a';
  const runIdA = 'run_test_worker_a';

  try {
    // 2.1 Insert test asset matching real PostgreSQL schema
    const assetFixture = buildAssetFixture(testRetryAssetId, 'ws_default', 'public', 'processing');
    const { error: insertAssetErr } = await supabase.from('assets').insert(assetFixture);
    assert(!insertAssetErr, 'Test asset created in Supabase assets table: ' + (insertAssetErr?.message || 'OK'));

    const initialLease = new Date(Date.now() + 60000).toISOString();
    // 2.2 Insert job initially in processing by workerA
    const { error: insertJobErr } = await supabase.from('processing_jobs').insert({
      id: testRetryJobId,
      workspace_id: 'ws_default',
      asset_id: testRetryAssetId,
      job_type: 'transcode_video',
      status: 'processing',
      locked_by: workerA,
      locked_at: new Date().toISOString(),
      lease_expires_at: initialLease,
      job_run_id: runIdA,
      attempt: 1,
      max_attempts: 3,
      priority: 10,
      available_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    assert(!insertJobErr, 'Test job created in processing_jobs table: ' + (insertJobErr?.message || 'OK'));

    // 2.3 Worker fails with retryable error (attempt 1 -> 2, backoff 25s)
    const backoffSeconds = 25;
    const { data: failRpcResult, error: failRpcError } = await supabase.rpc('fail_processing_job', {
      p_job_id: testRetryJobId,
      p_worker_id: workerA,
      p_job_run_id: runIdA,
      p_error_code: 'TRANSIENT_NETWORK',
      p_error_message: 'Simulated network timeout for backoff check',
      p_is_retryable: true,
      p_backoff_seconds: backoffSeconds,
    });

    assert(!failRpcError, 'fail_processing_job RPC executed without SQL error: ' + (failRpcError?.message || 'OK'));
    assert(failRpcResult && failRpcResult.success === true, 'fail_processing_job RPC succeeded for retryable transition');
    assert(failRpcResult && failRpcResult.status === 'retrying', 'fail_processing_job RPC returned status = retrying');
    assert(failRpcResult && failRpcResult.attempt === 2, 'fail_processing_job RPC incremented attempt to 2');

    // 2.4 Verify DB state: available_at delayed, lock released
    const { data: jobInDb } = await supabase
      .from('processing_jobs')
      .select('status, attempt, available_at, locked_by, lease_expires_at')
      .eq('id', testRetryJobId)
      .single();

    assert(jobInDb && jobInDb.status === 'retrying', 'DB: Job status transitioned to retrying');
    assert(jobInDb && jobInDb.attempt === 2, 'DB: Job attempt incremented to 2');
    assert(jobInDb && jobInDb.locked_by === null, 'DB: Worker lock released (locked_by is null)');
    assert(jobInDb && new Date(jobInDb.available_at).getTime() > Date.now() + 15000, 'DB: available_at is delayed ~25s into future');

    // 2.5 Verify no hot loop: Another worker immediately attempts to claim next job
    const { data: claimedRows } = await supabase.rpc('claim_next_processing_job', {
      p_worker_id: 'w_test_worker_b',
      p_lease_duration_seconds: 30,
    });

    const claimedTestJob = Array.isArray(claimedRows) ? claimedRows.find((r) => r.id === testRetryJobId) : null;
    assert(!claimedTestJob, 'claim_next_processing_job did NOT claim job before available_at (Hot loop strictly prevented!)');
  } catch (err) {
    assert(false, 'Step 2 failed with exception: ' + err.message);
  }

  // ----------------------------------------------------
  // STEP 3: Atomic CAS Fencing & Zombie Fail Rejection
  // ----------------------------------------------------
  console.log('\n--- STEP 3: Atomic CAS Fencing & Zombie Fail Rejection ---');
  const testFenceAssetId = 'med_v36_fence_' + Date.now();
  const testFenceJobId = 'job_v36_fence_' + Date.now();
  const legitimateWorker = 'w_worker_legit';
  const legitRunId = 'run_worker_legit';
  const zombieWorker = 'w_worker_zombie';

  try {
    await supabase.from('assets').insert(buildAssetFixture(testFenceAssetId, 'ws_default', 'public', 'processing'));

    const legitimateLease = new Date(Date.now() + 60000).toISOString();
    await supabase.from('processing_jobs').insert({
      id: testFenceJobId,
      workspace_id: 'ws_default',
      asset_id: testFenceAssetId,
      job_type: 'transcode_video',
      status: 'processing',
      locked_by: legitimateWorker,
      locked_at: new Date().toISOString(),
      lease_expires_at: legitimateLease,
      job_run_id: legitRunId,
      attempt: 2,
      max_attempts: 3,
      available_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // 3.1 Zombie Worker tries to fail the job
    const { data: zombieRes } = await supabase.rpc('fail_processing_job', {
      p_job_id: testFenceJobId,
      p_worker_id: zombieWorker,
      p_job_run_id: 'run_zombie_bogus',
      p_error_code: 'CORRUPTED_SOURCE',
      p_error_message: 'Zombie worker trying to fail job',
      p_is_retryable: false,
    });

    assert(zombieRes && zombieRes.success === false && zombieRes.reason === 'LEASE_LOST', 'Zombie worker fail attempt rejected with LEASE_LOST');

    // 3.2 Stale Run ID / Lease Token rejection
    const { data: staleRes } = await supabase.rpc('fail_processing_job', {
      p_job_id: testFenceJobId,
      p_worker_id: legitimateWorker,
      p_job_run_id: 'run_stale_old',
      p_error_code: 'CORRUPTED_SOURCE',
      p_error_message: 'Stale run id fail attempt',
      p_is_retryable: false,
    });

    assert(staleRes && staleRes.success === false && staleRes.reason === 'LEASE_LOST', 'Stale run ID rejected with LEASE_LOST');

    // 3.3 Atomic DLQ / Final Failure Cascade (Permanent error -> dead_letter + asset failed)
    const { data: validFailRes } = await supabase.rpc('fail_processing_job', {
      p_job_id: testFenceJobId,
      p_worker_id: legitimateWorker,
      p_job_run_id: legitRunId,
      p_error_code: 'CORRUPTED_SOURCE',
      p_error_message: 'Legitimate fatal failure moving to DLQ',
      p_is_retryable: false,
    });

    assert(validFailRes && validFailRes.success === true, 'Legitimate fail_processing_job accepted');
    assert(validFailRes && validFailRes.status === 'dead_letter', 'fail_processing_job returned status = dead_letter');

    // Check atomic update on BOTH processing_jobs and assets
    const { data: finalJob } = await supabase.from('processing_jobs').select('status, attempt').eq('id', testFenceJobId).single();
    const { data: finalAsset } = await supabase.from('assets').select('processing_status').eq('id', testFenceAssetId).single();

    assert(finalJob && finalJob.status === 'dead_letter', 'processing_jobs status atomically updated to dead_letter');
    assert(finalAsset && finalAsset.processing_status === 'failed', 'assets processing_status atomically updated to failed');
  } catch (err) {
    assert(false, 'Step 3 failed with exception: ' + err.message);
  }

  // ----------------------------------------------------
  // STEP 4: Subprocess Abortability (runAbortableProcess)
  // ----------------------------------------------------
  console.log('\n--- STEP 4: Subprocess Abortability (runAbortableProcess) ---');
  try {
    const { runAbortableProcess, extractPosterFrame, generateAnimatedTrailer, LeaseLostError } = require('../src/lib/media/workerCore');
    assert(typeof runAbortableProcess === 'function', 'runAbortableProcess is exported from workerCore');

    // Test aborting a spawned process with AbortController
    const controller = new AbortController();
    const startTime = Date.now();

    setTimeout(() => {
      controller.abort();
    }, 150);

    let caughtError = null;
    try {
      await runAbortableProcess('node', ['-e', 'setTimeout(() => {}, 10000)'], controller.signal);
    } catch (err) {
      caughtError = err;
    }

    const elapsed = Date.now() - startTime;
    assert(caughtError !== null, 'AbortController successfully terminated process with error');
    assert(
      caughtError instanceof LeaseLostError ||
      caughtError?.message?.includes('LEASE_LOST') ||
      caughtError?.message?.includes('SIGKILL') ||
      caughtError?.name === 'AbortError',
      'Error explicitly reflects lease lost / killed by SIGKILL: ' + caughtError?.message
    );
    assert(elapsed < 2000, 'Process was terminated immediately (' + elapsed + 'ms < 2000ms), no leak or hang');

    // Test passing an already aborted signal to extractPosterFrame
    const preAbortedController = new AbortController();
    preAbortedController.abort();
    let preAbortCaught = false;
    try {
      await extractPosterFrame('dummy.mp4', 'dummy.webp', 1.0, preAbortedController.signal);
    } catch (err) {
      preAbortCaught = true;
    }
    assert(preAbortCaught, 'extractPosterFrame immediately rejects when signal is pre-aborted');

    // Test passing an already aborted signal to generateAnimatedTrailer
    let trailerAbortCaught = false;
    try {
      await generateAnimatedTrailer('dummy.mp4', 'dummy.webp', 3.0, preAbortedController.signal);
    } catch (err) {
      trailerAbortCaught = true;
    }
    assert(trailerAbortCaught, 'generateAnimatedTrailer immediately rejects when signal is pre-aborted');
  } catch (err) {
    assert(false, 'Step 4 failed with exception: ' + err.message);
  }

  // ----------------------------------------------------
  // STEP 5: Synthetic Master Purged (Strict 425 & 503 HTTP Semantics)
  // ----------------------------------------------------
  console.log('\n--- STEP 5: Synthetic Master Purged (Strict 425 & 503 HTTP Semantics) ---');
  const testPendingAssetId = 'med_v36_pending_' + Date.now();
  const testReadyMissingAssetId = 'med_v36_missing_' + Date.now();

  try {
    // 5.1 Pending / Processing asset -> HTTP 425 Too Early
    await supabase.from('assets').insert(buildAssetFixture(testPendingAssetId, 'ws_default', 'public', 'processing'));

    const pendingRes = await fetch(BASE_URL + '/api/v1/delivery/video/' + testPendingAssetId + '/master.m3u8');
    const pendingJson = await pendingRes.json().catch(() => ({}));

    assert(pendingRes.status === 425, 'Pending video returns HTTP 425 Too Early (Actual: ' + pendingRes.status + ')');
    assert(pendingRes.headers.get('Retry-After') === '5', 'Retry-After header is 5 seconds');
    assert(pendingJson.error === 'TOO_EARLY', 'Error code is TOO_EARLY (Actual: ' + pendingJson.error + ')');

    // 5.2 Ready asset with missing artifact in storage -> HTTP 503 Service Unavailable
    await supabase.from('assets').insert(buildAssetFixture(testReadyMissingAssetId, 'ws_default', 'public', 'ready'));

    const missingRes = await fetch(BASE_URL + '/api/v1/delivery/video/' + testReadyMissingAssetId + '/master.m3u8');
    const missingJson = await missingRes.json().catch(() => ({}));

    assert(missingRes.status === 503, 'Ready asset with missing master artifact returns HTTP 503 (Actual: ' + missingRes.status + ')');
    assert(missingRes.headers.get('Retry-After') === '10', 'Retry-After header is 10 seconds');
    assert(missingJson.error === 'MEDIA_ARTIFACT_MISSING', 'Error code is MEDIA_ARTIFACT_MISSING (Actual: ' + missingJson.error + ')');
    assert(!JSON.stringify(missingJson).includes('#EXTM3U'), 'No synthetic #EXTM3U playlist is returned');
  } catch (err) {
    assert(false, 'Step 5 failed with exception: ' + err.message);
  }

  // ----------------------------------------------------
  // STEP 6: Multi-Tenant Delivery Guard (Zero Workspace Leakage)
  // ----------------------------------------------------
  console.log('\n--- STEP 6: Multi-Tenant Delivery Guard (Zero Workspace Leakage) ---');
  const testPrivateAssetId = 'med_v36_private_' + Date.now();

  try {
    // Create private asset in workspace 'ws_default'
    await supabase.from('assets').insert(buildAssetFixture(testPrivateAssetId, 'ws_default', 'private', 'processing'));

    // 6.1 Unauthenticated request -> HTTP 401 Unauthorized
    const unauthRes = await fetch(BASE_URL + '/api/v1/delivery/video/' + testPrivateAssetId + '/master.m3u8');
    const unauthJson = await unauthRes.json().catch(() => ({}));
    assert(unauthRes.status === 401, 'Unauthenticated request to private video returns HTTP 401 (Actual: ' + unauthRes.status + ')');
    assert(unauthJson.error === 'UNAUTHORIZED', 'Unauthenticated error code is UNAUTHORIZED');

    const unauthImgRes = await fetch(BASE_URL + '/api/v1/delivery/' + testPrivateAssetId);
    const unauthImgJson = await unauthImgRes.json().catch(() => ({}));
    assert(unauthImgRes.status === 401, 'Unauthenticated request to private image route returns HTTP 401 (Actual: ' + unauthImgRes.status + ')');
    assert(unauthImgJson.error === 'UNAUTHORIZED', 'Image unauthenticated error code is UNAUTHORIZED');

    // 6.2 Cross-tenant request from Tenant Beta -> HTTP 403 Forbidden
    const crossTenantHeaders = {
      Authorization: 'Bearer ' + workerToken,
      'X-Workspace-Id': 'ws_tenant_beta',
    };

    const crossTenantRes = await fetch(BASE_URL + '/api/v1/delivery/video/' + testPrivateAssetId + '/master.m3u8', {
      headers: crossTenantHeaders,
    });
    const crossTenantJson = await crossTenantRes.json().catch(() => ({}));

    assert(crossTenantRes.status === 403, 'Cross-tenant request to private video returns HTTP 403 Forbidden (Actual: ' + crossTenantRes.status + ')');
    assert(crossTenantJson.error === 'PERMISSION_DENIED', 'Cross-tenant error code is PERMISSION_DENIED (Actual: ' + crossTenantJson.error + ')');

    const crossTenantImgRes = await fetch(BASE_URL + '/api/v1/delivery/' + testPrivateAssetId, {
      headers: crossTenantHeaders,
    });
    const crossTenantImgJson = await crossTenantImgRes.json().catch(() => ({}));
    assert(crossTenantImgRes.status === 403, 'Cross-tenant request to private image route returns HTTP 403 (Actual: ' + crossTenantImgRes.status + ')');
    assert(crossTenantImgJson.error === 'PERMISSION_DENIED', 'Cross-tenant image error code is PERMISSION_DENIED');

    // 6.3 Legitimate Tenant Request from ws_default -> Passes authorization boundary
    const legitTenantHeaders = {
      Cookie: cookieHeader,
      'X-Workspace-Id': 'ws_default',
    };

    const legitTenantRes = await fetch(BASE_URL + '/api/v1/delivery/video/' + testPrivateAssetId + '/master.m3u8', {
      headers: legitTenantHeaders,
    });
    assert(legitTenantRes.status === 425, 'Legitimate tenant access passes authorization boundary (Status: ' + legitTenantRes.status + ', not 401/403)');

    // Also test with Admin Session Cookie (belongs to ws_default)
    const sessionRes = await fetch(BASE_URL + '/api/v1/delivery/video/' + testPrivateAssetId + '/master.m3u8', {
      headers: { Cookie: cookieHeader },
    });
    assert(sessionRes.status === 425, 'Admin session cookie passes tenant boundary (Status: ' + sessionRes.status + ')');
  } catch (err) {
    assert(false, 'Step 6 failed with exception: ' + err.message);
  }

  // ----------------------------------------------------
  // STEP 7: Clean up test artifacts in DB
  // ----------------------------------------------------
  console.log('\n--- STEP 7: Cleanup Test Artifacts ---');
  try {
    const assetIds = [testRetryAssetId, testFenceAssetId, testPendingAssetId, testReadyMissingAssetId, testPrivateAssetId];
    const jobIds = [testRetryJobId, testFenceJobId];

    await supabase.from('processing_jobs').delete().in('id', jobIds);
    await supabase.from('assets').delete().in('id', assetIds);
    console.log('  Cleaned up test jobs and assets from Supabase');
  } catch (err) {
    console.warn('  Cleanup warning:', err.message);
  }

  // ----------------------------------------------------
  // SUMMARY
  // ----------------------------------------------------
  console.log('\n======================================================');
  console.log('TOTAL TESTS: ' + (passed + failed));
  console.log('PASSED: ' + passed);
  console.log('FAILED: ' + failed);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runV36Tests().catch((err) => {
  console.error('Fatal error running v3.6 tests:', err);
  process.exit(1);
});
