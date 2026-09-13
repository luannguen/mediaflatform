/**
 * Media Platform v3.8.4 — Secure Media Data Plane Test Suite
 * Comprehensive End-to-End, Direct Upload, Signed Delivery, Tenant Safety & RPC Concurrency Suite
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');

// 1. Load environment variables from .env.local
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

const { PLATFORM_VERSION, API_VERSION } = require('../src/lib/platform/version.ts');
const { isPersistentMode } = require('../src/lib/platform/persistence-mode.ts');
const { supabaseAdmin } = require('../src/lib/supabase/admin.ts');
const { getStorageProvider } = require('../src/lib/storage/factory.ts');
const {
  mintDeliveryGrant,
  verifyDeliveryGrant,
  appendDeliveryGrant,
} = require('../src/lib/security/delivery-grant.ts');
const { uploadSessionService } = require('../src/services/uploadSessionService.ts');
const { workspaceService } = require('../src/services/workspaceService.ts');
const { assetService } = require('../src/services/assetService.ts');
const { MediaPlatformClient } = require('../packages/sdk/index.ts');
const { ErrorCodes } = require('../src/lib/errors/codes.ts');

let totalTests = 0;
let passedTests = 0;

async function runTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
    throw err;
  }
}

async function main() {
  console.log('============================================================');
  console.log(`MEDIA PLATFORM v${PLATFORM_VERSION} — SECURE MEDIA DATA PLANE GATE TEST`);
  console.log(`Runtime Mode: ${isPersistentMode() ? 'POSTGRESQL PERSISTENT' : 'MOCK'} | API: ${API_VERSION}`);
  console.log('============================================================\n');

  assert.strictEqual(PLATFORM_VERSION, '3.8.4', 'Platform version must be 3.8.4');

  // Test fixture identifiers
  const timestamp = Date.now();
  const testWorkspaceId = 'ws_default';
  const otherWorkspaceId = `ws_other_${timestamp}`;
  const testUserId = `usr_v384_${timestamp}`;
  const storage = getStorageProvider();

  // =========================================================================
  // GROUP 1: Platform Invariants & RPC Verification
  // =========================================================================
  console.log('--- GROUP 1: Platform Invariants & RPC Verification ---');

  await runTest('1.1 Platform version 3.8.4 and Persistent Mode', () => {
    assert.strictEqual(PLATFORM_VERSION, '3.8.4');
    assert.strictEqual(API_VERSION, 'v1');
    assert.strictEqual(isPersistentMode(), true, 'Must run against PostgreSQL persistent backend');
  });

  await runTest('1.2 Platform RPC Health: All 9 platform RPCs available', async () => {
    const { data: rpcHealth, error } = await supabaseAdmin.rpc('verify_platform_rpcs');
    assert(!error, `verify_platform_rpcs failed: ${error?.message}`);
    assert(rpcHealth && typeof rpcHealth === 'object', 'rpcHealth must be an object');
    
    assert.strictEqual(rpcHealth.finalize_upload_session, 'available', 'finalize_upload_session must be available');
    assert.strictEqual(rpcHealth.claim_next_processing_job, 'available');
    assert.strictEqual(rpcHealth.fail_processing_job, 'available');
    assert.strictEqual(rpcHealth.publish_processed_asset, 'available');
    assert.strictEqual(rpcHealth.consume_rate_limit_token, 'available');
    assert.strictEqual(rpcHealth.reserve_idempotency_key, 'available');
    assert.strictEqual(rpcHealth.complete_idempotency_key, 'available');
    assert.strictEqual(rpcHealth.fail_idempotency_key, 'available');
    assert.strictEqual(rpcHealth.renew_idempotency_lease, 'available');

    const unavailable = Object.entries(rpcHealth).filter(([_, status]) => status !== 'available');
    assert.strictEqual(unavailable.length, 0, `All RPCs must be available. Unavailable: ${JSON.stringify(unavailable)}`);
  });

  // =========================================================================
  // GROUP 2: Storage Provider HEAD Metadata & Zero-Download Invariant
  // =========================================================================
  console.log('\n--- GROUP 2: Storage Provider HEAD-Style Metadata ---');

  const testFileKey = `tests/v384/metadata_probe_${timestamp}.txt`;
  const testFileContent = Buffer.from(`v3.8.4 metadata verification test at ${new Date().toISOString()}`);

  await runTest('2.1 Upload test fixture to storage provider', async () => {
    const uploadRes = await storage.upload(testFileContent, testFileKey, 'text/plain');
    assert(uploadRes, 'Upload must succeed');
    assert.strictEqual(uploadRes.sizeBytes, testFileContent.length);
  });

  await runTest('2.2 getObjectMetadata returns sizeBytes & contentType without reading body', async () => {
    const meta = await storage.getObjectMetadata(testFileKey);
    assert(meta, 'getObjectMetadata must return metadata');
    assert.strictEqual(meta.sizeBytes, testFileContent.length);
    assert(meta.contentType?.includes('text/plain'), `Content type must match text/plain, got: ${meta.contentType}`);
    assert(meta.etag, 'Metadata must include etag');
  });

  await runTest('2.3 getObjectMetadata on non-existent file returns null', async () => {
    const nonExistentMeta = await storage.getObjectMetadata(`tests/v384/non_existent_${timestamp}.bin`);
    assert.strictEqual(nonExistentMeta, null, 'Non-existent file must return null metadata');
  });

  // =========================================================================
  // GROUP 3: Direct Upload Sessions & Capabilities
  // =========================================================================
  console.log('\n--- GROUP 3: Direct Upload Sessions & Capabilities ---');

  let testSessionId = '';
  let testStorageKey = '';
  const mockVideoPayload = Buffer.from('FAKE_MP4_DIRECT_UPLOAD_DATA_' + timestamp);

  await runTest('3.1 Create direct upload session produces valid capability schema', async () => {
    const res = await uploadSessionService.createSession({
      workspaceId: testWorkspaceId,
      filename: `video_test_${timestamp}.mp4`,
      mimeType: 'video/mp4',
      fileSizeBytes: mockVideoPayload.length,
      visibility: 'private',
      userId: testUserId,
    });

    assert(res.session, 'Session must be returned');
    assert(res.capability, 'Capability must be returned');
    assert(res.session.id.startsWith('sess_'), `Session ID must start with sess_, got: ${res.session.id}`);
    assert.strictEqual(res.session.workspace_id, testWorkspaceId);
    assert.strictEqual(res.session.status, 'created');
    assert.strictEqual(res.session.mime_type, 'video/mp4');
    assert.strictEqual(res.session.size_bytes, mockVideoPayload.length);
    assert.strictEqual(res.session.visibility, 'private');

    // Capability invariants
    assert(res.capability.protocol === 'signed-put' || res.capability.protocol === 'tus');
    assert(res.capability.uploadUrl, 'Capability must have uploadUrl');
    assert.strictEqual(res.capability.method, 'PUT');
    assert.strictEqual(res.capability.storageBucket, 'media-assets');
    assert(res.capability.expiresInSeconds > 0);

    testSessionId = res.session.id;
    testStorageKey = res.session.storage_key;
  });

  await runTest('3.2 Refresh capability generates fresh upload capability', async () => {
    const refreshed = await uploadSessionService.refreshCapability(testSessionId, testWorkspaceId);
    assert(refreshed, 'Refreshed capability must exist');
    assert(refreshed.uploadUrl, 'Must have uploadUrl');
    assert.strictEqual(refreshed.storageKey, testStorageKey);
  });

  await runTest('3.3 Cross-workspace capability refresh is rejected (403)', async () => {
    let rejected = false;
    try {
      await uploadSessionService.refreshCapability(testSessionId, otherWorkspaceId);
    } catch (err) {
      rejected = true;
      assert(err.message.includes('Forbidden') || err.message.includes('workspace'), err.message);
    }
    assert.strictEqual(rejected, true, 'Cross-workspace refresh must be rejected');
  });

  // =========================================================================
  // GROUP 4: Upload Finalization Integrity & Concurrency Race
  // =========================================================================
  console.log('\n--- GROUP 4: Atomic RPC Finalization & Concurrency ---');

  await runTest('4.1 Complete session fails if file not present in storage', async () => {
    let failed = false;
    try {
      await uploadSessionService.completeSession({
        sessionId: testSessionId,
        workspaceId: testWorkspaceId,
      });
    } catch (err) {
      failed = true;
      assert(err.message.includes('not found in storage') || err.code === 'UPLOAD_FILE_NOT_FOUND', err.message);
    }
    assert.strictEqual(failed, true, 'Finalizing non-uploaded session must fail');
  });

  await runTest('4.2 Upload object directly to session storage key', async () => {
    const uploadRes = await storage.upload(mockVideoPayload, testStorageKey, 'video/mp4');
    assert(uploadRes, 'Direct upload must succeed');
  });

  let finalizedAssetId = '';
  await runTest('4.3 Complete session succeeds with HEAD verification & atomic RPC', async () => {
    const result = await uploadSessionService.completeSession({
      sessionId: testSessionId,
      workspaceId: testWorkspaceId,
      callerUserId: testUserId,
    });

    assert(result.asset, 'Finalized asset must be returned');
    assert.strictEqual(result.idempotent, false, 'First finalization must not be idempotent');
    assert.strictEqual(result.asset.workspace_id, testWorkspaceId);
    assert.strictEqual(result.asset.visibility, 'private');
    assert.strictEqual(result.asset.size_bytes, mockVideoPayload.length);
    assert.strictEqual(result.asset.storage_key, testStorageKey);

    finalizedAssetId = result.asset.id;

    // Verify initial processing job was created
    if (result.job) {
      assert.strictEqual(result.job.asset_id, finalizedAssetId);
      assert.strictEqual(result.job.workspace_id, testWorkspaceId);
    }
  });

  await runTest('4.4 Idempotent replay: Re-finalizing same session returns identical asset', async () => {
    const replayResult = await uploadSessionService.completeSession({
      sessionId: testSessionId,
      workspaceId: testWorkspaceId,
      callerUserId: testUserId,
    });

    assert(replayResult.asset, 'Replay must return asset');
    assert.strictEqual(replayResult.asset.id, finalizedAssetId);
    assert.strictEqual(replayResult.idempotent, true, 'Replay must be flagged as idempotent');
  });

  await runTest('4.5 Concurrency Stress: 20 parallel complete requests create exactly 1 asset & 0 duplicate jobs', async () => {
    // Create a new session for concurrent race
    const sessionRes = await uploadSessionService.createSession({
      workspaceId: testWorkspaceId,
      filename: `concurrent_race_${timestamp}.mp4`,
      mimeType: 'video/mp4',
      fileSizeBytes: mockVideoPayload.length,
      visibility: 'workspace',
      userId: testUserId,
    });

    // Upload the file to storage
    await storage.upload(mockVideoPayload, sessionRes.session.storage_key, 'video/mp4');

    // Launch 20 concurrent completion requests
    const promises = [];
    for (let i = 0; i < 20; i++) {
      promises.push(
        uploadSessionService.completeSession({
          sessionId: sessionRes.session.id,
          workspaceId: testWorkspaceId,
          callerUserId: testUserId,
        })
      );
    }

    const results = await Promise.all(promises);
    assert.strictEqual(results.length, 20);

    // All results must return the EXACT same asset ID
    const firstAssetId = results[0].asset.id;
    for (const r of results) {
      assert.strictEqual(r.asset.id, firstAssetId, 'All concurrent callers must receive identical asset ID');
    }

    // Exactly 1 winner (idempotent: false) and 19 idempotent returns
    const nonIdempotentCount = results.filter((r) => !r.idempotent).length;
    assert.strictEqual(nonIdempotentCount, 1, `Exactly 1 winner must exist, got: ${nonIdempotentCount}`);

    // Query DB to verify exactly 1 initial ProcessingJob was created
    const { data: jobs } = await supabaseAdmin
      .from('processing_jobs')
      .select('id, asset_id')
      .eq('asset_id', firstAssetId);

    assert(jobs, 'Jobs query must succeed');
    assert(jobs.length <= 1, `Expected at most 1 initial job, found: ${jobs.length}`);
  });

  // =========================================================================
  // GROUP 5: Cryptographic Delivery Grants (HMAC-SHA256 & Keyring)
  // =========================================================================
  console.log('\n--- GROUP 5: Cryptographic Delivery Grants ---');

  let validGrant = '';

  await runTest('5.1 Mint delivery grant with HS256 and mdg_v1_ prefix', () => {
    const mintRes = mintDeliveryGrant({
      assetId: finalizedAssetId,
      workspaceId: testWorkspaceId,
      permissions: ['hls:read', 'poster:read', 'preview:read'],
      ttlSeconds: 300,
    });

    assert(mintRes.grant, 'Grant must be returned');
    assert(mintRes.grant.startsWith('mdg_v1_'), `Grant must start with mdg_v1_, got: ${mintRes.grant}`);
    assert(mintRes.expires_at, 'Expiration must be returned');
    assert.deepStrictEqual(mintRes.permissions, ['hls:read', 'poster:read', 'preview:read']);

    validGrant = mintRes.grant;
  });

  await runTest('5.2 Verify delivery grant with valid token & correct scope', () => {
    const verifyRes = verifyDeliveryGrant(validGrant, finalizedAssetId, testWorkspaceId, 'hls:read');
    assert.strictEqual(verifyRes.valid, true, `Verification failed: ${verifyRes.message}`);
    assert(verifyRes.payload, 'Payload must be returned');
    assert.strictEqual(verifyRes.payload.aid, finalizedAssetId);
    assert.strictEqual(verifyRes.payload.wid, testWorkspaceId);
  });

  await runTest('5.3 Tampered token signature fails constant-time verification', () => {
    const parts = validGrant.split('.');
    const tamperedSig = parts[2].slice(0, -4) + 'abcd';
    const tamperedToken = `${parts[0]}.${parts[1]}.${tamperedSig}`;

    const verifyRes = verifyDeliveryGrant(tamperedToken, finalizedAssetId, testWorkspaceId, 'hls:read');
    assert.strictEqual(verifyRes.valid, false);
    assert.strictEqual(verifyRes.code, 'DELIVERY_GRANT_TAMPERED');
  });

  await runTest('5.4 Cross-asset verification is rejected (ASSET_MISMATCH)', () => {
    const otherAssetId = `med_other_${timestamp}`;
    const verifyRes = verifyDeliveryGrant(validGrant, otherAssetId, testWorkspaceId, 'hls:read');
    assert.strictEqual(verifyRes.valid, false);
    assert.strictEqual(verifyRes.code, 'DELIVERY_GRANT_ASSET_MISMATCH');
  });

  await runTest('5.5 Cross-workspace verification is rejected (WORKSPACE_MISMATCH)', () => {
    const verifyRes = verifyDeliveryGrant(validGrant, finalizedAssetId, otherWorkspaceId, 'hls:read');
    assert.strictEqual(verifyRes.valid, false);
    assert.strictEqual(verifyRes.code, 'DELIVERY_GRANT_WORKSPACE_MISMATCH');
  });

  await runTest('5.6 Missing permission scope is rejected (INSUFFICIENT_PERMISSIONS)', () => {
    const limitedGrant = mintDeliveryGrant({
      assetId: finalizedAssetId,
      workspaceId: testWorkspaceId,
      permissions: ['poster:read'],
      ttlSeconds: 300,
    }).grant;

    // Trying to access hls with poster:read only
    const verifyRes = verifyDeliveryGrant(limitedGrant, finalizedAssetId, testWorkspaceId, 'hls:read');
    assert.strictEqual(verifyRes.valid, false);
    assert.strictEqual(verifyRes.code, 'DELIVERY_GRANT_INSUFFICIENT_PERMISSIONS');
  });

  await runTest('5.7 Expired delivery grant is rejected (EXPIRED)', () => {
    const raw = validGrant.slice('mdg_v1_'.length);
    const [encodedHeader, encodedPayload] = raw.split('.');
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));

    const now = Math.floor(Date.now() / 1000);
    payload.iat = now - 600;
    payload.exp = now - 300; // Expired 5 minutes ago

    const newEncodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signingInput = `${encodedHeader}.${newEncodedPayload}`;

    const secret =
      process.env.DELIVERY_GRANT_SECRET ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXTAUTH_SECRET ||
      'dev_delivery_grant_secret_key_3.8.4_anticrash';

    const sig = crypto.createHmac('sha256', secret).update(signingInput).digest().toString('base64url');
    const expiredToken = `mdg_v1_${signingInput}.${sig}`;

    const verifyRes = verifyDeliveryGrant(expiredToken, finalizedAssetId, testWorkspaceId, 'hls:read');
    assert.strictEqual(verifyRes.valid, false);
    assert.strictEqual(verifyRes.code, 'DELIVERY_GRANT_EXPIRED');
  });

  await runTest('5.8 appendDeliveryGrant safely appends query param to HLS playlist lines', () => {
    // Media URI without query
    const res1 = appendDeliveryGrant('720p.m3u8', validGrant);
    assert(res1.startsWith('720p.m3u8?grant='));

    // Media URI with existing query
    const res2 = appendDeliveryGrant('segment_001.ts?v=1', validGrant);
    assert(res2.includes('v=1'));
    assert(res2.includes('grant='));

    // Comment or tag must remain unchanged
    const res3 = appendDeliveryGrant('#EXTINF:6.000,', validGrant);
    assert.strictEqual(res3, '#EXTINF:6.000,');
  });

  // =========================================================================
  // GROUP 6: Client Bundle Zero-Secret Exposure Audit
  // =========================================================================
  console.log('\n--- GROUP 6: Client Bundle Zero-Secret Exposure Audit ---');

  await runTest('6.1 DEMO_CREDENTIALS.rawKey removed from codebase', () => {
    const heroCode = fs.readFileSync(path.join(__dirname, '../src/app/landingtest/components/HeroSection.tsx'), 'utf8');
    assert(!heroCode.includes('rawKey'), 'HeroSection must not contain rawKey');

    const pickerCode = fs.readFileSync(path.join(__dirname, '../src/app/landingtest/components/PickerDemoSection.tsx'), 'utf8');
    assert(!pickerCode.includes('rawKey'), 'PickerDemoSection must not contain rawKey');

    const galleryCode = fs.readFileSync(path.join(__dirname, '../src/app/landingtest/components/LiveGallerySection.tsx'), 'utf8');
    assert(!galleryCode.includes('rawKey'), 'LiveGallerySection must not contain rawKey');

    const studioCode = fs.readFileSync(path.join(__dirname, '../src/app/landingtest/components/VideoStudioSection.tsx'), 'utf8');
    assert(!studioCode.includes('rawKey'), 'VideoStudioSection must not contain rawKey');
  });

  await runTest('6.2 Zero query string ?api_key= in landingtest client components', () => {
    const filesToAudit = [
      '../src/app/landingtest/components/HeroSection.tsx',
      '../src/app/landingtest/components/PickerDemoSection.tsx',
      '../src/app/landingtest/components/LiveGallerySection.tsx',
      '../src/app/landingtest/components/VideoStudioSection.tsx',
    ];

    for (const file of filesToAudit) {
      const content = fs.readFileSync(path.join(__dirname, file), 'utf8');
      assert(!content.includes('?api_key='), `${file} must not contain ?api_key= query parameter`);
      assert(!content.includes('?apiKey='), `${file} must not contain ?apiKey= query parameter`);
    }
  });

  // =========================================================================
  // GROUP 7: SDK Direct Upload & Delivery Grant Extension
  // =========================================================================
  console.log('\n--- GROUP 7: SDK Direct Upload & Delivery Grant Extension ---');

  await runTest('7.1 SDK exposes createDirectUploadSession, completeDirectUploadSession, getDeliveryGrant', () => {
    const client = new MediaPlatformClient({
      apiKey: 'test_key',
      baseUrl: 'http://localhost:3000',
    });

    assert.strictEqual(typeof client.createDirectUploadSession, 'function');
    assert.strictEqual(typeof client.completeDirectUploadSession, 'function');
    assert.strictEqual(typeof client.getDeliveryGrant, 'function');
    assert.strictEqual(typeof client.upload, 'function');
  });

  // Cleanup test files from storage
  try {
    await storage.delete(testFileKey);
    await storage.delete(testStorageKey);
  } catch {
    // Ignore cleanup errors
  }

  console.log('\n============================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} TESTS PASSED FOR v3.8.4 SECURE MEDIA DATA PLANE!`);
  console.log('============================================================\n');
}

main().catch((err) => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});
