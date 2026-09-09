const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Load environment variables from .env.local if present
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
const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;

async function runResilientQueueTests() {
  console.log('=== STARTING v3.2 RESILIENT QUEUE, ATOMIC CLAIM & DLQ TEST SUITE ===\n');

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

  let cookieHeader = '';

  // 1. Authenticate as Admin
  console.log('--- STEP 1: Authentication ---');
  if (!adminEmail || !adminPassword) {
    assert(false, 'ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env.local or environment');
    return;
  }

  try {
    const loginRes = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: adminEmail,
        password: adminPassword,
      }),
    });

    const setCookies = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [loginRes.headers.get('set-cookie')];
    cookieHeader = setCookies.map((c) => c?.split(';')[0]).filter(Boolean).join('; ');
    assert(loginRes.ok, `Admin authenticated successfully (HTTP ${loginRes.status})`);
  } catch (err) {
    assert(false, `Admin login failed: ${err.message}`);
    return;
  }

  // 2. Test 1: Atomic Job Claiming & Anti-Race Condition
  console.log('\n--- STEP 2: Atomic Job Claiming (Race Condition Prevention) ---');
  let testAsset1Id = null;
  let testJob1Id = null;

  try {
    // Create test video asset via uploads
    const dummyBuffer = Buffer.alloc(1024);
    const formData = new FormData();
    formData.append('file', new Blob([dummyBuffer], { type: 'video/mp4' }), `race-test-${Date.now()}.mp4`);
    formData.append('display_name', 'Race Condition Test Video');

    const uploadRes = await fetch(`${BASE_URL}/api/v1/uploads`, {
      method: 'POST',
      headers: { 'Cookie': cookieHeader },
      body: formData,
    });
    const uploadJson = await uploadRes.json();
    testAsset1Id = uploadJson.data?.id;
    testJob1Id = uploadJson.data?.job_id;

    assert(!!testJob1Id, `Created test job for atomic claim: ${testJob1Id}`);

    // Simulate 2 workers attempting to claim next job simultaneously
    const workerAId = `worker_sim_A_${Date.now()}`;
    const workerBId = `worker_sim_B_${Date.now()}`;

    // Direct service or API process call
    const [resA, resB] = await Promise.all([
      fetch(`${BASE_URL}/api/v1/jobs/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': cookieHeader },
        body: JSON.stringify({ worker_id: workerAId }),
      }),
      fetch(`${BASE_URL}/api/v1/jobs/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': cookieHeader },
        body: JSON.stringify({ worker_id: workerBId }),
      }),
    ]);

    const jsonA = await resA.json();
    const jsonB = await resB.json();

    const jobA = jsonA.data?.job;
    const jobB = jsonB.data?.job;

    // Exactly one worker claims testJob1Id, the other either claims another or gets null
    const aGotTestJob = jobA?.id === testJob1Id;
    const bGotTestJob = jobB?.id === testJob1Id;

    assert(
      (aGotTestJob && !bGotTestJob) || (!aGotTestJob && bGotTestJob),
      `Zero duplicate processing: exactly ONE worker claimed job ${testJob1Id}`
    );
  } catch (err) {
    assert(false, `Atomic claim test failed: ${err.message}`);
  }

  // 3. Test 2: Heartbeat Renewal & Lease Extension
  console.log('\n--- STEP 3: Distributed Heartbeat Renewal & Lease Security ---');
  try {
    // Create a fresh job
    const dummyBuffer = Buffer.alloc(1024);
    const formData = new FormData();
    formData.append('file', new Blob([dummyBuffer], { type: 'video/mp4' }), `heartbeat-test-${Date.now()}.mp4`);
    const uploadRes = await fetch(`${BASE_URL}/api/v1/uploads`, {
      method: 'POST',
      headers: { 'Cookie': cookieHeader },
      body: formData,
    });
    const uploadJson = await uploadRes.json();
    const heartbeatJobId = uploadJson.data?.job_id;

    // We can claim it partially or test heartbeat endpoint directly
    const testWorkerId = `worker_hb_${Date.now()}`;
    
    // Heartbeat for non-processing job should reject or fail gracefully
    const invalidHbRes = await fetch(`${BASE_URL}/api/v1/jobs/${heartbeatJobId}/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookieHeader },
      body: JSON.stringify({ worker_id: 'worker_intruder', lease_seconds: 300 }),
    });
    assert(invalidHbRes.status === 400, `Heartbeat for non-processing job is safely rejected (HTTP ${invalidHbRes.status})`);
  } catch (err) {
    assert(false, `Heartbeat test failed: ${err.message}`);
  }

  // 4. Test 3: Retry Taxonomy & Exponential Backoff
  console.log('\n--- STEP 4: Retry Taxonomy & Exponential Backoff ---');
  try {
    // Create job to test retry backoff
    const dummyBuffer = Buffer.alloc(1024);
    const formData = new FormData();
    formData.append('file', new Blob([dummyBuffer], { type: 'video/mp4' }), `retryable-test-${Date.now()}.mp4`);
    const uploadRes = await fetch(`${BASE_URL}/api/v1/uploads`, {
      method: 'POST',
      headers: { 'Cookie': cookieHeader },
      body: formData,
    });
    const uploadJson = await uploadRes.json();
    const retryJobId = uploadJson.data?.job_id;

    // Call fail endpoint with retryable error STORAGE_TIMEOUT
    const failRes = await fetch(`${BASE_URL}/api/v1/jobs/${retryJobId}/fail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookieHeader },
      body: JSON.stringify({
        error_code: 'STORAGE_TIMEOUT',
        error_message: 'Simulated Cloud Storage Network Timeout',
        retryable: true,
      }),
    });
    const failedJob = (await failRes.json()).data?.job;

    assert(failedJob?.status === 'retrying', `Retryable error transitioned job status to 'retrying' (got: ${failedJob?.status})`);
    assert(failedJob?.attempt === 2, `Job attempt counter incremented to 2 (got: ${failedJob?.attempt})`);
    assert(!!failedJob?.available_at, `Job assigned available_at for exponential backoff`);

    const nowTime = Date.now();
    const availableTime = new Date(failedJob?.available_at).getTime();
    const diffSec = Math.round((availableTime - nowTime) / 1000);
    assert(diffSec >= 20 && diffSec <= 35, `Backoff delay is ~30s for attempt 1 (diff: ${diffSec}s)`);

    // Verify immediate claim cannot pick up job during backoff window
    const claimRes = await fetch(`${BASE_URL}/api/v1/jobs/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookieHeader },
      body: JSON.stringify({ worker_id: `premature_worker_${Date.now()}` }),
    });
    const claimJson = await claimRes.json();
    const prematureClaim = claimJson.data?.job;
    if (prematureClaim) {
      assert(prematureClaim.id !== retryJobId, `Worker does NOT claim job before available_at exponential backoff expires`);
    } else {
      assert(true, `Worker respects backoff window (no job claimed prematurely)`);
    }
  } catch (err) {
    assert(false, `Retry taxonomy test failed: ${err.message}`);
  }

  // 5. Test 4: Dead Letter Queue (DLQ) for Permanent Errors
  console.log('\n--- STEP 5: Dead Letter Queue (DLQ) for Permanent Errors ---');
  let dlqJobId = null;
  try {
    const dummyBuffer = Buffer.alloc(1024);
    const formData = new FormData();
    formData.append('file', new Blob([dummyBuffer], { type: 'video/mp4' }), `corrupt-test-${Date.now()}.mp4`);
    const uploadRes = await fetch(`${BASE_URL}/api/v1/uploads`, {
      method: 'POST',
      headers: { 'Cookie': cookieHeader },
      body: formData,
    });
    const uploadJson = await uploadRes.json();
    dlqJobId = uploadJson.data?.job_id;

    // Simulate permanent error CORRUPTED_SOURCE via fail endpoint
    const failDlqRes = await fetch(`${BASE_URL}/api/v1/jobs/${dlqJobId}/fail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookieHeader },
      body: JSON.stringify({
        error_code: 'CORRUPTED_SOURCE',
        error_message: 'Source video file header is corrupted or unreadable',
        retryable: true, // Even if retryable is passed true, permanent error should bypass retry!
        error_details: { format: 'unknown', error_code: 'MOOV_BOX_MISSING' },
      }),
    });
    const dlqJob = (await failDlqRes.json()).data?.job;

    assert(dlqJob?.status === 'dead_letter', `Permanent error immediately routed to 'dead_letter' (got: ${dlqJob?.status})`);
    assert(dlqJob?.error_taxonomy === 'CORRUPTED_SOURCE', `Error taxonomy recorded as CORRUPTED_SOURCE`);

    // Verify DLQ endpoint GET /api/v1/jobs/dead-letter
    const dlqRes = await fetch(`${BASE_URL}/api/v1/jobs/dead-letter`, {
      headers: { 'Cookie': cookieHeader },
    });
    assert(dlqRes.status === 200, `GET /api/v1/jobs/dead-letter returned HTTP 200`);
    const dlqJson = await dlqRes.json();
    const foundDlq = dlqJson.data?.items?.find((j) => j.id === dlqJobId);
    assert(!!foundDlq, `Found job ${dlqJobId} in Dead Letter Queue API response`);
    assert(foundDlq?.error_taxonomy === 'CORRUPTED_SOURCE', `DLQ item contains error_taxonomy metadata`);
  } catch (err) {
    assert(false, `Dead Letter Queue test failed: ${err.message}`);
  }

  // 6. Test 5: Resurrect Job from Dead Letter Queue
  console.log('\n--- STEP 6: Resurrect & Re-queue Job from DLQ ---');
  try {
    const resurrectRes = await fetch(`${BASE_URL}/api/v1/jobs/${dlqJobId}/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookieHeader },
      body: JSON.stringify({ reset_attempts: true }),
    });

    assert(resurrectRes.status === 200, `POST /api/v1/jobs/${dlqJobId}/retry returned HTTP 200`);
    const resurrectJob = (await resurrectRes.json()).data?.job;

    assert(resurrectJob?.status === 'queued', `Job resurrected to 'queued' state`);
    assert(resurrectJob?.attempt === 1, `Job attempt counter reset to 1`);
    assert(resurrectJob?.error_code === null, `Error code cleared upon resurrection`);

    // Now process it to completion
    const processRes = await fetch(`${BASE_URL}/api/v1/jobs/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookieHeader },
      body: JSON.stringify({ job_id: dlqJobId, worker_id: 'dlq_recovery_worker' }),
    });
    const completedJob = (await processRes.json()).data?.job;
    assert(completedJob?.status === 'completed', `Resurrected job processed successfully to 'completed'`);
    assert(!!completedJob?.output_version, `Completed job has deterministic output_version: ${completedJob?.output_version}`);
  } catch (err) {
    assert(false, `DLQ resurrection test failed: ${err.message}`);
  }

  // 7. Test 6: Queue Metrics Endpoint
  console.log('\n--- STEP 7: Queue Operations & Telemetry Metrics ---');
  try {
    const metricsRes = await fetch(`${BASE_URL}/api/v1/jobs/metrics`, {
      headers: { 'Cookie': cookieHeader },
    });
    assert(metricsRes.status === 200, `GET /api/v1/jobs/metrics returned HTTP 200`);
    const metrics = (await metricsRes.json()).data;

    assert(typeof metrics?.total === 'number', `Metrics contains total count (${metrics?.total})`);
    assert(typeof metrics?.queued === 'number', `Metrics contains queued count (${metrics?.queued})`);
    assert(typeof metrics?.processing === 'number', `Metrics contains processing count (${metrics?.processing})`);
    assert(typeof metrics?.retrying === 'number', `Metrics contains retrying count (${metrics?.retrying})`);
    assert(typeof metrics?.dead_letter === 'number', `Metrics contains dead_letter count (${metrics?.dead_letter})`);
    assert(typeof metrics?.completed === 'number', `Metrics contains completed count (${metrics?.completed})`);
    assert(typeof metrics?.active_leases === 'number', `Metrics contains active_leases count (${metrics?.active_leases})`);
  } catch (err) {
    assert(false, `Queue metrics test failed: ${err.message}`);
  }

  // 8. Test 7: Standalone Queue Consumer Daemon (--once)
  console.log('\n--- STEP 8: Standalone Worker Daemon Execution ---');
  try {
    // Create a fresh test job
    const dummyBuffer = Buffer.alloc(1024);
    const formData = new FormData();
    formData.append('file', new Blob([dummyBuffer], { type: 'video/mp4' }), `daemon-test-${Date.now()}.mp4`);
    formData.append('display_name', 'Daemon Execution Test Video');
    const uploadRes = await fetch(`${BASE_URL}/api/v1/uploads`, {
      method: 'POST',
      headers: { 'Cookie': cookieHeader },
      body: formData,
    });
    const uploadJson = await uploadRes.json();
    const daemonJobId = uploadJson.data?.job_id;

    assert(!!daemonJobId, `Created test job for daemon worker: ${daemonJobId}`);

    // Execute standalone runner with --once
    const daemonOutput = execSync('node scripts/run-queue-worker.js --once', {
      encoding: 'utf8',
      cwd: path.resolve(__dirname, '..'),
      timeout: 30000,
    });

    assert(daemonOutput.includes('[QueueDaemon]'), `Daemon process initialized successfully`);
    assert(
      daemonOutput.includes('Successfully processed job') || daemonOutput.includes('One-shot execution complete'),
      `Daemon successfully pulled and processed queue job`
    );

    // Allow socket pool to refresh after execSync
    await new Promise((resolve) => setTimeout(resolve, 500));

    let checkJob = null;
    for (let retry = 0; retry < 3; retry++) {
      try {
        const checkRes = await fetch(`${BASE_URL}/api/v1/jobs/${daemonJobId}`, {
          headers: { 'Cookie': cookieHeader, 'Connection': 'close' },
        });
        if (checkRes.ok) {
          const json = await checkRes.json();
          checkJob = json.data;
          break;
        }
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    assert(checkJob?.status === 'completed', `Job ${daemonJobId} marked 'completed' by standalone daemon`);
  } catch (err) {
    assert(false, `Daemon worker execution failed: ${err.message}`);
  }

  console.log('\n==================================================');
  console.log(`v3.2 RESILIENT QUEUE TEST SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runResilientQueueTests();
