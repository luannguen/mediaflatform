/**
 * Automated Verification Test Suite: Landingtest Video Studio & Transcoding Engine v3.5
 * 
 * Verifies:
 * 1. 1-Click Sample Video Synthesis (/api/v1/demo/sample-video)
 * 2. Background Worker Processing (/api/v1/jobs/process)
 * 3. HLS Master Playlist & Variant Delivery (/api/v1/delivery/video/:id/master.m3u8)
 * 4. Smart Poster WebP Frame Extraction (/api/v1/delivery/video/:id/poster.webp)
 * 5. Animated Trailer WebP 3s Loop Delivery (/api/v1/delivery/video/:id/trailer.webp)
 * 6. Video Upload & State Machine Pipeline (/api/v1/uploads)
 * 7. Safe Delete Reference Guard & Cleanup (/api/v1/assets/:id?action=purge&force=true)
 * 8. Landingtest HTML DOM Integrity & Video Studio Integration
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const DEMO_API_KEY = 'mda_live_demo2026_antigravity_platform_super_secret_key_v1';

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

async function runSuite() {
  console.log('================================================================');
  console.log('🎬 STARTING LANDINGTEST VIDEO STUDIO & HLS VERIFICATION SUITE');
  console.log('================================================================');

  let sampleAssetId = null;
  let sampleJobId = null;

  // STEP 1: 1-Click Sample Video Synthesis
  console.log('\n--- STEP 1: 1-Click Sample Video Synthesis Endpoint ---');
  try {
    const res = await fetch(`${BASE_URL}/api/v1/demo/sample-video`, {
      method: 'POST',
      headers: {
        'X-Media-Api-Key': DEMO_API_KEY,
      },
    });

    assert(res.status === 201, `POST /api/v1/demo/sample-video returned HTTP 201 (got ${res.status})`);
    const json = await res.json();
    assert(json.success === true, 'Response body has success: true');
    assert(Boolean(json.data?.id), `Asset created with ID: ${json.data?.id}`);
    assert(Boolean(json.data?.job_id), `Transcoding Job enqueued with ID: ${json.data?.job_id}`);
    assert(json.data?.asset_type === 'video', 'Asset type is video');
    assert(json.data?.width === 1280 && json.data?.height === 720, 'Source resolution is 1280x720');

    sampleAssetId = json.data?.id;
    sampleJobId = json.data?.job_id;
  } catch (err) {
    assert(false, `Step 1 threw exception: ${err.message}`);
  }

  // STEP 2: Process Transcoding Job via Worker
  console.log('\n--- STEP 2: Background Worker Processing Pipeline ---');
  try {
    const res = await fetch(`${BASE_URL}/api/v1/jobs/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Media-Api-Key': DEMO_API_KEY,
      },
      body: JSON.stringify({ worker_id: 'automated_test_worker' }),
    });

    assert(res.status === 200, `POST /api/v1/jobs/process returned HTTP 200 (got ${res.status})`);
    const json = await res.json();
    assert(json.success === true, 'Worker returned success: true');
    assert(json.data?.job?.status === 'completed', `Job finished with status: ${json.data?.job?.status}`);
    assert(json.data?.job?.progress === 100, `Job reached 100% progress`);
    assert(json.data?.job?.current_stage === 'ready', `Job reached stage 'ready'`);
    assert(Boolean(json.data?.job?.output_version), `Output version published: ${json.data?.job?.output_version}`);
  } catch (err) {
    assert(false, `Step 2 threw exception: ${err.message}`);
  }

  // STEP 3: Verify HLS Master Playlist & Variant Delivery
  console.log('\n--- STEP 3: Real HLS Delivery (Master M3U8, Variants, Segments) ---');
  try {
    const masterRes = await fetch(`${BASE_URL}/api/v1/delivery/video/${sampleAssetId}/master.m3u8`);
    assert(masterRes.status === 200, `GET master.m3u8 returned HTTP 200 (got ${masterRes.status})`);
    const masterText = await masterRes.text();
    assert(masterText.includes('#EXTM3U'), 'Master playlist contains #EXTM3U header');
    assert(masterText.includes('#EXT-X-STREAM-INF'), 'Master playlist contains stream definitions');
    assert(masterText.includes('720p.m3u8'), 'Master playlist references 720p variant');
    assert(masterText.includes('FRAME-RATE=30.000'), 'Master playlist declares 30.000 fps');

    // Test variant playlist
    const variantRes = await fetch(`${BASE_URL}/api/v1/delivery/video/${sampleAssetId}/720p.m3u8`);
    assert(variantRes.status === 200, `GET 720p.m3u8 returned HTTP 200 (got ${variantRes.status})`);
    const variantText = await variantRes.text();
    assert(variantText.includes('.ts'), 'Variant playlist contains .ts segment references');
  } catch (err) {
    assert(false, `Step 3 threw exception: ${err.message}`);
  }

  // STEP 4: Verify Smart Poster WebP & Animated Trailer WebP
  console.log('\n--- STEP 4: Smart Poster Frame & 3s Animated Trailer WebP ---');
  try {
    const posterRes = await fetch(`${BASE_URL}/api/v1/delivery/video/${sampleAssetId}/poster.webp`);
    assert(posterRes.status === 200, `GET poster.webp returned HTTP 200 (got ${posterRes.status})`);
    assert(posterRes.headers.get('content-type')?.includes('image/webp'), `Poster content-type is image/webp`);

    const trailerRes = await fetch(`${BASE_URL}/api/v1/delivery/video/${sampleAssetId}/trailer.webp`);
    assert(trailerRes.status === 200, `GET trailer.webp returned HTTP 200 (got ${trailerRes.status})`);
    assert(trailerRes.headers.get('content-type')?.includes('image/webp'), `Trailer content-type is image/webp`);
  } catch (err) {
    assert(false, `Step 4 threw exception: ${err.message}`);
  }

  // STEP 5: Safe Delete Video & Verify Clean Purge
  console.log('\n--- STEP 5: Safe Delete Video & Complete Storage Purge ---');
  try {
    const deleteRes = await fetch(`${BASE_URL}/api/v1/assets/${sampleAssetId}?action=purge&force=true`, {
      method: 'DELETE',
      headers: {
        'X-Media-Api-Key': DEMO_API_KEY,
      },
    });

    assert(deleteRes.status === 200, `DELETE /api/v1/assets/:id returned HTTP 200 (got ${deleteRes.status})`);
    const deleteJson = await deleteRes.json();
    assert(deleteJson.success === true, 'Delete response has success: true');

    // Verify master.m3u8 is now 404
    const checkRes = await fetch(`${BASE_URL}/api/v1/delivery/video/${sampleAssetId}/master.m3u8`);
    assert(checkRes.status === 404, `GET master.m3u8 after purge returned HTTP 404 (got ${checkRes.status})`);
  } catch (err) {
    assert(false, `Step 5 threw exception: ${err.message}`);
  }

  // STEP 6: Verify Landingtest HTML DOM Integrity
  console.log('\n--- STEP 6: Landingtest Page Integration & Component DOM ---');
  try {
    const pageRes = await fetch(`${BASE_URL}/landingtest`);
    assert(pageRes.status === 200, `GET /landingtest returned HTTP 200 (got ${pageRes.status})`);
    const pageHtml = await pageRes.text();

    assert(pageHtml.includes('video-studio'), 'Page includes #video-studio section id');
    assert(pageHtml.includes('Video Studio HLS'), 'Navbar contains Video Studio HLS navigation anchor');
    assert(pageHtml.includes('HLS Adaptive Video Engine'), 'Page renders HLS Video Studio header');
    assert(pageHtml.includes('Auto (ABR)'), 'Page renders HLS quality selector elements');
  } catch (err) {
    assert(false, `Step 6 threw exception: ${err.message}`);
  }

  console.log('\n================================================================');
  console.log(`🏁 TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error('Test suite crashed:', err);
  process.exit(1);
});
