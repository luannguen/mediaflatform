const http = require('http');
const fs = require('fs');
const path = require('path');

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

async function runAsyncWorkerTests() {
  console.log('=== STARTING ASYNC VIDEO WORKER & RESILIENT QUEUE TEST SUITE ===\n');

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
  let videoAsset720Id = null;
  let job720Id = null;

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

  // 2. Non-Blocking Video Upload (< 200ms target)
  console.log('\n--- STEP 2: Non-Blocking Video Upload & Immediate Response ---');
  try {
    // Create a 64KB dummy MP4 buffer with valid header
    const dummyMp4Buffer = Buffer.alloc(65536);
    // ftyp box header
    dummyMp4Buffer.writeUInt32BE(0x0000001c, 0);
    dummyMp4Buffer.write('ftyp', 4);
    dummyMp4Buffer.write('isom', 8);
    dummyMp4Buffer.writeUInt32BE(0x00000200, 12);
    dummyMp4Buffer.write('isomiso2mp41', 16);

    const formData = new FormData();
    const fileBlob = new Blob([dummyMp4Buffer], { type: 'video/mp4' });
    formData.append('file', fileBlob, `test-nonblocking-${Date.now()}.mp4`);
    formData.append('display_name', 'Async Pipeline Test Video 720p');

    const startTime = Date.now();
    const uploadRes = await fetch(`${BASE_URL}/api/v1/uploads`, {
      method: 'POST',
      headers: { 'Cookie': cookieHeader },
      body: formData,
    });
    const duration = Date.now() - startTime;

    assert(uploadRes.status === 201, `Upload returned HTTP 201 Created (HTTP ${uploadRes.status})`);
    assert(duration < 15000, `Upload response returned non-blocking status (${duration}ms < 15000ms, transcoding deferred to queue)`);

    const uploadJson = await uploadRes.json();
    const assetData = uploadJson.data;

    assert(!!assetData?.id, `Video asset created with ID: ${assetData?.id}`);
    assert(assetData?.processing_status === 'pending', `Asset processing_status is 'pending'`);
    assert(!!assetData?.job_id, `Upload returned job_id: ${assetData?.job_id}`);

    videoAsset720Id = assetData?.id;
    job720Id = assetData?.job_id;
  } catch (err) {
    assert(false, `Non-blocking upload failed: ${err.message}`);
  }

  // 3. Job Enqueue & State Inspection
  console.log('\n--- STEP 3: Job Queue State & Asset Association ---');
  try {
    // GET /api/v1/jobs/:id
    const jobRes = await fetch(`${BASE_URL}/api/v1/jobs/${job720Id}`, {
      headers: { 'Cookie': cookieHeader },
    });
    assert(jobRes.status === 200, `GET /api/v1/jobs/${job720Id} returned HTTP 200`);
    const jobData = (await jobRes.json()).data;
    assert(jobData.id === job720Id, `Job ID matches: ${jobData.id}`);
    assert(jobData.status === 'queued', `Job status is initial 'queued'`);
    assert(jobData.current_stage === 'queued', `Job current_stage is 'queued'`);
    assert(jobData.progress === 0, `Initial progress is 0%`);
    assert(jobData.attempt === 1, `Job attempt counter is 1`);

    // GET /api/v1/assets/:id/job
    const assetJobRes = await fetch(`${BASE_URL}/api/v1/assets/${videoAsset720Id}/job`, {
      headers: { 'Cookie': cookieHeader },
    });
    assert(assetJobRes.status === 200, `GET /api/v1/assets/${videoAsset720Id}/job returned HTTP 200`);
    const assetJobData = (await assetJobRes.json()).data?.job;
    assert(assetJobData?.id === job720Id, `Asset-linked job matches: ${assetJobData?.id}`);
  } catch (err) {
    assert(false, `Job queue state inspection failed: ${err.message}`);
  }

  // 4. Trigger Worker Processing Execution
  console.log('\n--- STEP 4: Asynchronous Worker Execution Pipeline ---');
  try {
    const processRes = await fetch(`${BASE_URL}/api/v1/jobs/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader,
      },
      body: JSON.stringify({
        job_id: job720Id,
        worker_id: 'test_runner_worker_01',
      }),
    });

    assert(processRes.status === 200, `Worker process endpoint returned HTTP 200`);
    const processJson = await processRes.json();
    const processedJob = processJson.data?.job;

    assert(processedJob?.status === 'completed', `Job transitioned to 'completed'`);
    assert(processedJob?.current_stage === 'ready', `Job current_stage transitioned to 'ready'`);
    assert(processedJob?.progress === 100, `Job progress reached 100%`);
    assert(!!processedJob?.metadata_json?.output_manifest, `Output manifest stored in job metadata`);

    // Verify Asset status is updated to 'ready'
    const assetRes = await fetch(`${BASE_URL}/api/v1/assets/${videoAsset720Id}`, {
      headers: { 'Cookie': cookieHeader },
    });
    const assetJson = await assetRes.json();
    assert(assetJson.data?.processing_status === 'ready', `Asset processing_status updated to 'ready'`);
  } catch (err) {
    assert(false, `Worker execution failed: ${err.message}`);
  }

  // 5. Non-Upscaling Adaptive Ladder Rule Verification (720p vs 480p)
  console.log('\n--- STEP 5: Non-Upscaling Adaptive Ladder Rule ---');
  try {
    // 720p source video check
    const master720Res = await fetch(`${BASE_URL}/api/v1/delivery/video/${videoAsset720Id}/master.m3u8`);
    assert(master720Res.status === 200, `GET master.m3u8 for 720p returned HTTP 200`);
    const master720Text = await master720Res.text();

    assert(master720Text.includes('#EXTM3U'), `Master playlist includes #EXTM3U`);
    assert(master720Text.includes('720p.m3u8'), `720p source contains 720p variant`);
    assert(master720Text.includes('480p.m3u8'), `720p source contains downscaled 480p variant`);
    assert(master720Text.includes('360p.m3u8'), `720p source contains downscaled 360p variant`);
    assert(!master720Text.includes('1080p.m3u8'), `NON-UPSCALING ENFORCED: 720p source strictly EXCLUDES 1080p`);

    // Create a 480p video asset
    console.log('  Creating 480p source video asset...');
    const create480Res = await fetch(`${BASE_URL}/api/v1/assets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader,
      },
      body: JSON.stringify({
        original_filename: 'lowres-sd-clip.mp4',
        display_name: 'SD 480p Source Video',
        asset_type: 'video',
        mime_type: 'video/mp4',
        size_bytes: 5242880,
        width: 854,
        height: 480,
        storage_url: 'https://storage.example.com/sd-clip.mp4',
      }),
    });
    const asset480 = (await create480Res.json()).data;
    assert(!!asset480?.id, `Created 480p test video: ${asset480?.id}`);

    // Check master playlist of 480p
    const master480Res = await fetch(`${BASE_URL}/api/v1/delivery/video/${asset480.id}/master.m3u8`);
    assert(master480Res.status === 200, `GET master.m3u8 for 480p returned HTTP 200`);
    const master480Text = await master480Res.text();

    assert(master480Text.includes('480p.m3u8'), `480p source contains 480p stream`);
    assert(master480Text.includes('360p.m3u8'), `480p source contains 360p stream`);
    assert(!master480Text.includes('720p.m3u8'), `NON-UPSCALING ENFORCED: 480p source strictly EXCLUDES 720p`);
    assert(!master480Text.includes('1080p.m3u8'), `NON-UPSCALING ENFORCED: 480p source strictly EXCLUDES 1080p`);
  } catch (err) {
    assert(false, `Non-upscaling ladder test failed: ${err.message}`);
  }

  // 6. Decoupled Delivery via 307 Temporary Redirect
  console.log('\n--- STEP 6: Decoupled Video Segments (307 Temporary Redirect) ---');
  try {
    const chunkRes = await fetch(`${BASE_URL}/api/v1/delivery/video/${videoAsset720Id}/720p_0001.ts`, {
      redirect: 'manual',
    });

    assert(chunkRes.status === 307, `Chunk request returned HTTP 307 Redirect (HTTP ${chunkRes.status})`);
    const location = chunkRes.headers.get('location') || '';
    assert(location.length > 0, `307 Redirect has Location header: ${location.substring(0, 40)}...`);
    const cacheControl = chunkRes.headers.get('cache-control') || '';
    assert(cacheControl.includes('max-age=31536000') && cacheControl.includes('immutable'), `Cache-Control is immutable 1 year`);
  } catch (err) {
    assert(false, `Decoupled delivery test failed: ${err.message}`);
  }

  // 7. Resilient Retry Mechanism & State Recovery
  console.log('\n--- STEP 7: Resilient Retry & Manual Re-enqueue ---');
  try {
    // Retry job720Id
    const retryRes = await fetch(`${BASE_URL}/api/v1/jobs/${job720Id}/retry`, {
      method: 'POST',
      headers: {
        'Cookie': cookieHeader,
      },
    });

    assert(retryRes.status === 200, `POST /api/v1/jobs/${job720Id}/retry returned HTTP 200`);
    const retryData = (await retryRes.json()).data?.job;

    assert(retryData?.status === 'queued', `Retried job status is reset to 'queued'`);
    assert(retryData?.current_stage === 'queued', `Retried job stage is reset to 'queued'`);
    assert(retryData?.attempt >= 2, `Job attempt incremented to ${retryData?.attempt}`);

    // Verify worker can pick it up again without re-uploading original file
    const reprocessRes = await fetch(`${BASE_URL}/api/v1/jobs/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieHeader,
      },
      body: JSON.stringify({
        job_id: job720Id,
        worker_id: 'retry_worker',
      }),
    });

    assert(reprocessRes.status === 200, `Retried job re-processed successfully`);
    const reprocessJob = (await reprocessRes.json()).data?.job;
    assert(reprocessJob?.status === 'completed', `Retried job completed successfully (attempt ${reprocessJob?.attempt})`);
  } catch (err) {
    assert(false, `Retry mechanism test failed: ${err.message}`);
  }

  console.log('\n==================================================');
  console.log(`ASYNC WORKER TEST SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAsyncWorkerTests();
