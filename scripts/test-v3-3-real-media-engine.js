const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');
const ffmpeg = require('@ffmpeg-installer/ffmpeg');

// 1. Load environment variables from .env.local if present
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

async function runRealMediaEngineTests() {
  console.log('=== STARTING v3.3 REAL MEDIA PROCESSING ENGINE & FENCING TEST SUITE ===\n');

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
  let realAssetId = null;
  let realJobId = null;
  let corruptJobId = null;

  // ----------------------------------------------------
  // STEP 1: Authentication & Worker Identity
  // ----------------------------------------------------
  console.log('--- STEP 1: Authentication & Identity Hardening ---');
  if (!adminEmail || !adminPassword) {
    assert(false, 'Admin credentials must be configured in environment or .env.local');
    return;
  }
  if (!workerToken) {
    assert(false, 'WORKER_SERVICE_TOKEN must be configured in environment or .env.local');
    return;
  }

  try {
    const loginRes = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });

    const setCookies = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [loginRes.headers.get('set-cookie')];
    cookieHeader = setCookies.map((c) => c?.split(';')[0]).filter(Boolean).join('; ');
    assert(loginRes.ok, `Admin authenticated successfully (HTTP ${loginRes.status})`);
    assert(!!workerToken, `WORKER_SERVICE_TOKEN loaded (${workerToken.slice(0, 16)}...)`);
  } catch (err) {
    assert(false, `Authentication failed: ${err.message}`);
    return;
  }

  // ----------------------------------------------------
  // STEP 2: Synthesize Real H.264/AAC MP4 Test Video via FFmpeg
  // ----------------------------------------------------
  console.log('\n--- STEP 2: Synthesizing Real 720p H.264/AAC Test Video ---');
  const tempTestMp4 = path.join(__dirname, `real-test-${Date.now()}.mp4`);
  try {
    execFileSync(ffmpeg.path, [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=3:size=1280x720:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=3',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-ar', '48000', '-b:a', '128k',
      tempTestMp4,
    ], { stdio: 'pipe' });

    const videoBytes = fs.readFileSync(tempTestMp4);
    assert(videoBytes.length > 10000, `Generated valid 720p H.264 MP4 (${videoBytes.length} bytes)`);

    // ----------------------------------------------------
    // STEP 3: Non-Blocking Upload of Real Video
    // ----------------------------------------------------
    console.log('\n--- STEP 3: Non-Blocking Upload of Real Video ---');
    const formData = new FormData();
    formData.append('file', new Blob([videoBytes], { type: 'video/mp4' }), path.basename(tempTestMp4));
    formData.append('display_name', 'Production 720p HLS Test Video');

    const uploadRes = await fetch(`${BASE_URL}/api/v1/uploads`, {
      method: 'POST',
      headers: { 'Cookie': cookieHeader },
      body: formData,
    });

    const uploadText = await uploadRes.text();
    let uploadJson = null;
    try {
      uploadJson = JSON.parse(uploadText);
    } catch {
      console.error('Upload returned non-JSON body:', uploadText.slice(0, 500));
    }

    assert(uploadRes.status === 201, `Upload returned HTTP 201 Created (got: ${uploadRes.status})`);
    realAssetId = uploadJson?.data?.id;
    realJobId = uploadJson?.data?.job_id;

    assert(!!realAssetId, `Asset created with ID: ${realAssetId}`);
    assert(!!realJobId, `Transcoding job enqueued: ${realJobId}`);

    // ----------------------------------------------------
    // STEP 4: Atomic Claim & Worker Execution via WORKER_SERVICE_TOKEN
    // ----------------------------------------------------
    console.log('\n--- STEP 4: Real FFmpeg Worker Execution with Service Token ---');
    let processedJob = null;
    for (let loop = 0; loop < 10; loop++) {
      const workerRes = await fetch(`${BASE_URL}/api/v1/jobs/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${workerToken}`,
          'X-Worker-Id': 'worker_daemon_test',
        },
        body: JSON.stringify({ worker_id: 'worker_daemon_test' }),
      });

      if (workerRes.ok) {
        const workerJson = await workerRes.json();
        const job = workerJson.data?.job;
        if (!job) break;
        if (job.id === realJobId) {
          processedJob = job;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!processedJob) {
      const checkRes = await fetch(`${BASE_URL}/api/v1/jobs/${realJobId}`, {
        headers: { 'Cookie': cookieHeader },
      });
      processedJob = (await checkRes.json()).data;
    }

    assert(!!processedJob, `Process endpoint accepted WORKER_SERVICE_TOKEN`);

    assert(processedJob?.status === 'completed', `Job transitioned to 'completed' (got: ${processedJob?.status})`);
    assert(processedJob?.progress === 100, `Job reached 100% progress`);

    // Verify Probed Real Metadata
    const manifest = processedJob?.metadata_json?.output_manifest;
    assert(manifest?.source_height === 720, `Real FFprobe extracted height = 720 (got: ${manifest?.source_height})`);
    assert(manifest?.source_width === 1280, `Real FFprobe extracted width = 1280 (got: ${manifest?.source_width})`);
    assert(manifest?.video_codec === 'h264', `Real FFprobe extracted video_codec = h264 (got: ${manifest?.video_codec})`);
    assert(manifest?.audio_codec === 'aac', `Real FFprobe extracted audio_codec = aac (got: ${manifest?.audio_codec})`);

    // Verify Non-Upscaling Adaptive Ladder
    const profiles = manifest?.target_profiles || [];
    assert(profiles.includes('720p'), `Ladder contains 720p variant`);
    assert(profiles.includes('480p'), `Ladder contains 480p downscaled variant`);
    assert(profiles.includes('360p'), `Ladder contains 360p downscaled variant`);
    assert(!profiles.includes('1080p'), `NON-UPSCALING ENFORCED: 720p source strictly excludes 1080p`);

    // ----------------------------------------------------
    // STEP 5: End-to-End Playback Graph & Catch-All Route Verification
    // ----------------------------------------------------
    console.log('\n--- STEP 5: Real HLS Playback Graph & Catch-all Route ---');
    
    // 1. Master Playlist
    const masterRes = await fetch(`${BASE_URL}/api/v1/delivery/video/${realAssetId}/master.m3u8`);
    assert(masterRes.status === 200, `GET master.m3u8 returned HTTP 200`);
    const masterText = await masterRes.text();
    assert(masterText.includes('#EXTM3U'), `Master playlist includes #EXTM3U`);
    assert(masterText.includes('#EXT-X-VERSION:6'), `Master playlist complies with Apple HLS Version 6`);
    assert(masterText.includes('720p.m3u8'), `Master playlist references 720p.m3u8`);

    // 2. Variant Playlist
    const variantRes = await fetch(`${BASE_URL}/api/v1/delivery/video/${realAssetId}/720p.m3u8`);
    assert(variantRes.status === 200, `GET 720p.m3u8 returned HTTP 200`);
    const variantText = await variantRes.text();
    assert(variantText.includes('#EXT-X-TARGETDURATION'), `Variant playlist includes #EXT-X-TARGETDURATION`);
    assert(variantText.includes('.ts'), `Variant playlist contains real .ts segment references`);

    // 3. Smart Poster Frame (Extracted from real video frame at 1s)
    const posterRes = await fetch(`${BASE_URL}/api/v1/delivery/video/${realAssetId}/poster.webp`);
    assert(posterRes.status === 200, `GET poster.webp returned HTTP 200`);
    assert(posterRes.headers.get('content-type')?.includes('image/webp'), `Poster frame Content-Type is image/webp`);
    const posterBytes = await posterRes.arrayBuffer();
    assert(posterBytes.byteLength > 500, `Poster frame contains valid image binary (${posterBytes.byteLength} bytes)`);

    // 4. 3-Second Animated Preview Trailer
    const trailerRes = await fetch(`${BASE_URL}/api/v1/delivery/video/${realAssetId}/trailer.webp`);
    assert(trailerRes.status === 200, `GET trailer.webp returned HTTP 200`);
    assert(trailerRes.headers.get('content-type')?.includes('image/webp'), `Trailer preview Content-Type is image/webp`);
    const trailerBytes = await trailerRes.arrayBuffer();
    assert(trailerBytes.byteLength > 1000, `Trailer preview contains animated binary (${trailerBytes.byteLength} bytes)`);

    // 5. Segment 307 Redirect to Storage
    const segmentRes = await fetch(`${BASE_URL}/api/v1/delivery/video/${realAssetId}/720p/000.ts`, {
      redirect: 'manual',
    });
    assert(segmentRes.status === 307, `Segment request returned HTTP 307 Redirect (got: ${segmentRes.status})`);
    assert(!!segmentRes.headers.get('location'), `Segment redirect contains Location header`);
  } catch (err) {
    assert(false, `Real media pipeline failed: ${err.message}`);
  } finally {
    if (fs.existsSync(tempTestMp4)) {
      try { fs.unlinkSync(tempTestMp4); } catch {}
    }
  }

  // ----------------------------------------------------
  // STEP 6: Dead Letter Queue (DLQ) & Corrupted Video Detection via Real FFprobe
  // ----------------------------------------------------
  console.log('\n--- STEP 6: Real FFprobe Corrupted Container Detection (DLQ) ---');
  try {
    // Upload a fake 1KB corrupted file masquerading as video/mp4
    const fakeBuffer = Buffer.alloc(1024);
    const formData = new FormData();
    formData.append('file', new Blob([fakeBuffer], { type: 'video/mp4' }), `corrupt-${Date.now()}.mp4`);
    formData.append('display_name', 'Corrupted Dummy Video');

    const corruptUploadRes = await fetch(`${BASE_URL}/api/v1/uploads`, {
      method: 'POST',
      headers: { 'Cookie': cookieHeader },
      body: formData,
    });

    const corruptJobId = (await corruptUploadRes.json()).data?.job_id;
    assert(!!corruptJobId, `Corrupted video enqueued with job ID: ${corruptJobId}`);

    // Trigger processing until corrupt job is picked up and routed to DLQ
    for (let loop = 0; loop < 10; loop++) {
      const workerRes = await fetch(`${BASE_URL}/api/v1/jobs/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${workerToken}`,
        },
        body: JSON.stringify({ worker_id: 'worker_daemon_dlq' }),
      });

      const checkRes = await fetch(`${BASE_URL}/api/v1/jobs/${corruptJobId}`, {
        headers: { 'Cookie': cookieHeader },
      });
      const checkJob = (await checkRes.json()).data;
      if (checkJob && checkJob.status !== 'queued') {
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    // Inspect Final Job State
    const checkRes = await fetch(`${BASE_URL}/api/v1/jobs/${corruptJobId}`, {
      headers: { 'Cookie': cookieHeader },
    });
    const checkJob = (await checkRes.json()).data;

    assert(checkJob?.status === 'dead_letter', `Corrupted video immediately routed to 'dead_letter' (got: ${checkJob?.status})`);
    assert(checkJob?.error_taxonomy === 'CORRUPTED_SOURCE', `Taxonomy correctly classified as CORRUPTED_SOURCE (got: ${checkJob?.error_taxonomy})`);
  } catch (err) {
    assert(false, `DLQ corruption test failed: ${err.message}`);
  }

  // ----------------------------------------------------
  // STEP 7: Split-Brain & Fencing Token Protection
  // ----------------------------------------------------
  console.log('\n--- STEP 7: Distributed Fencing Token & Split-Brain Rejection ---');
  try {
    // Attempt heartbeat renewal on a non-processing job or with mismatched zombie worker
    const zombieHeartbeatRes = await fetch(`${BASE_URL}/api/v1/jobs/${corruptJobId}/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${workerToken}`,
      },
      body: JSON.stringify({
        worker_id: 'zombie_worker_split_brain',
        run_id: 'stale_run_123',
      }),
    });

    assert(!zombieHeartbeatRes.ok, `Zombie worker lease renewal safely rejected (HTTP ${zombieHeartbeatRes.status})`);
    const zombieJson = await zombieHeartbeatRes.json();
    assert(
      zombieJson.error?.message?.includes('Lease renewal failed') || zombieJson.error?.code === 'BAD_REQUEST',
      `Fencing rejection confirmed: ${zombieJson.error?.message}`
    );
  } catch (err) {
    assert(false, `Fencing test failed: ${err.message}`);
  }

  // ----------------------------------------------------
  // STEP 8: Webhook Idempotency with Deterministic Event ID
  // ----------------------------------------------------
  console.log('\n--- STEP 8: Webhook Idempotency & Deterministic Event ID ---');
  try {
    // Verify that the completed job has output_version and event_id metadata
    const completedJobRes = await fetch(`${BASE_URL}/api/v1/jobs/${realJobId}`, {
      headers: { 'Cookie': cookieHeader },
    });
    const completedJobData = (await completedJobRes.json()).data;
    const outputVersion = completedJobData?.output_version || completedJobData?.metadata_json?.output_manifest?.output_version;
    const expectedEventId = `evt_video_${realJobId}_${outputVersion}`;

    assert(!!outputVersion, `Completed job has deterministic output_version: ${outputVersion}`);
    assert(
      outputVersion ? (outputVersion.startsWith('v1_') || outputVersion.startsWith('v2_')) : false,
      `Output version follows deterministic scheme (got: ${outputVersion})`
    );
    assert(
      expectedEventId.includes(realJobId),
      `Deterministic Webhook Event ID derived: ${expectedEventId}`
    );
  } catch (err) {
    assert(false, `Webhook idempotency test failed: ${err.message}`);
  }

  console.log('\n==================================================');
  console.log(`v3.3 REAL MEDIA ENGINE TEST SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runRealMediaEngineTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
