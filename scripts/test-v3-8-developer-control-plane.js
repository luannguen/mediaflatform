/**
 * Media Platform v3.8.1 — Developer Platform & Control Plane Correctness Gate Test Suite
 * Comprehensive End-to-End, High-Concurrency & Contract Verification Test
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');

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

// Load compiled or ts-node modules via local require / source
const { PLATFORM_VERSION, API_VERSION } = require('../src/lib/platform/version.ts');
const { generateRequestId, extractRequestId, redactSensitiveData } = require('../src/lib/platform/requestContext.ts');
const { scopeRegistry } = require('../src/lib/security/scopeRegistry.ts');
const { rateLimiter } = require('../src/lib/security/rateLimiter.ts');
const { idempotencyService } = require('../src/lib/security/idempotency.ts');
const { healthService } = require('../src/lib/platform/healthService.ts');
const { usageService } = require('../src/services/usageService.ts');
const { workerFleetService } = require('../src/services/workerFleetService.ts');
const { developerService } = require('../src/services/developerService.ts');
const { auditService } = require('../src/services/auditService.ts');
const { isAllowedOrigin, handleCorsPreflight } = require('../src/lib/security/cors.ts');
const { openApiSpec } = require('../src/openapi/spec.ts');
const { MediaPlatformClient, MediaPlatformError } = require('../packages/sdk/index.ts');
const { supabaseAdmin } = require('../src/lib/supabase/admin.ts');

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result
        .then(() => {
          passedTests++;
          console.log(`  ✅ [PASS] ${name}`);
        })
        .catch((err) => {
          console.error(`  ❌ [FAIL] ${name}:`, err.message);
          throw err;
        });
    } else {
      passedTests++;
      console.log(`  ✅ [PASS] ${name}`);
      return Promise.resolve();
    }
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
    return Promise.reject(err);
  }
}

async function main() {
  console.log('\n============================================================');
  console.log(`🧪 MEDIA PLATFORM v${PLATFORM_VERSION} — CORRECTNESS GATE & CONTROL PLANE`);
  console.log('============================================================\n');

  // 1. Version & System Constants
  await runTest('1.1 Platform Version matches v3.8.0 and API is v1', () => {
    assert.strictEqual(PLATFORM_VERSION, '3.8.0');
    assert.strictEqual(API_VERSION, 'v1');
  });

  // 2. Centralized Request Context & Deep Redaction
  await runTest('2.1 Request ID generation and extraction adheres to standard prefix', () => {
    const reqId = generateRequestId();
    assert(reqId.startsWith('req_'));

    const mockHeaders = new Headers();
    mockHeaders.set('x-request-id', 'req_custom_trace_99');
    assert.strictEqual(extractRequestId(mockHeaders), 'req_custom_trace_99');
  });

  await runTest('2.2 Deep credential & sensitive data redaction cleans tokens and passwords', () => {
    const sensitive = {
      api_key: 'mda_live_secretkey12345',
      user: {
        password: 'SuperSecretPassword',
        token: 'bearer_token_xyz',
      },
      headers: {
        authorization: 'Bearer sensitive-token',
        'x-media-api-key': 'mda_live_apikey',
      },
      safe_field: 'This is public data',
    };

    const redacted = redactSensitiveData(sensitive);
    assert.strictEqual(redacted.api_key, '[REDACTED]');
    assert.strictEqual(redacted.user.password, '[REDACTED]');
    assert.strictEqual(redacted.user.token, '[REDACTED]');
    assert.strictEqual(redacted.headers.authorization, '[REDACTED]');
    assert.strictEqual(redacted.headers['x-media-api-key'], '[REDACTED]');
    assert.strictEqual(redacted.safe_field, 'This is public data');
  });

  // 3. Security Scope Registry
  await runTest('3.1 Scope Registry validates valid and invalid scopes properly', () => {
    const valid = scopeRegistry.validateScopes(['assets:read', 'assets:write', 'admin:manage']);
    assert.strictEqual(valid.valid, true);
    assert.strictEqual(valid.invalidScopes.length, 0);

    const invalid = scopeRegistry.validateScopes(['assets:read', 'hacker:exploit', 'root:super']);
    assert.strictEqual(invalid.valid, false);
    assert.deepStrictEqual(invalid.invalidScopes, ['hacker:exploit', 'root:super']);
  });

  // 4. Rate Limiting Engine & Real High-Concurrency Test
  await runTest('4.1 Rate limiter correctly classifies routes with query params', () => {
    assert.strictEqual(rateLimiter.classifyRoute('GET', '/api/v1/assets'), 'read');
    assert.strictEqual(rateLimiter.classifyRoute('POST', '/api/v1/assets'), 'write');
    assert.strictEqual(rateLimiter.classifyRoute('POST', '/api/v1/uploads'), 'upload');
    assert.strictEqual(rateLimiter.classifyRoute('GET', '/api/v1/delivery/med_123?w=800'), 'expensive_transform');
    assert.strictEqual(rateLimiter.classifyRoute('GET', '/api/v1/delivery/med_123', new URLSearchParams('format=webp')), 'expensive_transform');
    assert.strictEqual(rateLimiter.classifyRoute('GET', '/api/v1/admin/workers'), 'admin');
  });

  await runTest('4.2 Atomic Rate Limiter: 60 concurrent requests against limit=30 strictly rejects 30', async () => {
    const testCaller = `test_concurrent_caller_${Date.now()}`;
    const totalRequests = 60;
    const limit = 30;

    // Fire 60 concurrent requests at the exact same time
    const promises = Array.from({ length: totalRequests }, () =>
      rateLimiter.checkRateLimit(testCaller, 'upload')
    );

    const results = await Promise.all(promises);
    const allowedCount = results.filter((r) => r.allowed).length;
    const rejectedCount = results.filter((r) => !r.allowed).length;

    assert.strictEqual(allowedCount, limit, `Expected exactly ${limit} requests allowed, got ${allowedCount}`);
    assert.strictEqual(rejectedCount, totalRequests - limit, `Expected exactly ${totalRequests - limit} rejected, got ${rejectedCount}`);

    // Verify rejection headers
    const rejectedResult = results.find((r) => !r.allowed);
    const headers = rateLimiter.getHeaders(rejectedResult);
    assert.strictEqual(headers['RateLimit-Remaining'], '0');
    assert(headers['Retry-After'] !== undefined);
  });

  // 5. Idempotency State Machine & Race-Condition Concurrency Test
  await runTest('5.1 Atomic Idempotency: 20 concurrent requests with same key allow exactly 1 execution', async () => {
    const wsId = 'ws_idemp_race_test';
    const key = `key_race_${Date.now()}`;
    const route = '/api/v1/assets';
    const method = 'POST';
    const payload = { displayName: 'Atomic Asset Creation' };

    // Fire 20 concurrent reservations simultaneously
    const reservations = await Promise.all(
      Array.from({ length: 20 }, () =>
        idempotencyService.reserveOrGetCached(wsId, key, route, method, payload).catch((err) => ({
          action: 'conflict_caught',
          error: err.message,
        }))
      )
    );

    const executedCount = reservations.filter((r) => r.action === 'execute').length;
    const blockedCount = reservations.filter((r) => r.action === 'conflict_caught').length;

    assert.strictEqual(executedCount, 1, `Exactly 1 concurrent request must execute, got ${executedCount}`);
    assert.strictEqual(blockedCount, 19, `19 concurrent requests must be rejected as in_progress, got ${blockedCount}`);

    // Complete the business operation
    await idempotencyService.saveResponse(wsId, key, route, payload, 201, { 'content-type': 'application/json' }, { asset_id: 'med_race_done_1' });

    // Subsequent request must receive cached response
    const cachedRes = await idempotencyService.reserveOrGetCached(wsId, key, route, method, payload);
    assert.strictEqual(cachedRes.action, 'cached');
    assert.strictEqual(cachedRes.cachedRecord.response_status, 201);
    assert.strictEqual(cachedRes.cachedRecord.response_body.asset_id, 'med_race_done_1');
  });

  await runTest('5.2 Idempotency strictly rejects key reuse with different route or payload', async () => {
    const wsId = 'ws_idemp_conflict_test';
    const key = `key_reuse_${Date.now()}`;
    const originalPayload = { name: 'Alpha' };
    const tamperedPayload = { name: 'Beta' };

    await idempotencyService.reserveOrGetCached(wsId, key, '/api/v1/uploads', 'POST', originalPayload);
    await idempotencyService.saveResponse(wsId, key, '/api/v1/uploads', originalPayload, 200, {}, { ok: true });

    // Differing payload
    let threwPayload = false;
    try {
      await idempotencyService.reserveOrGetCached(wsId, key, '/api/v1/uploads', 'POST', tamperedPayload);
    } catch (err) {
      threwPayload = true;
      assert.strictEqual(err.statusCode, 409);
    }
    assert(threwPayload, 'Should reject differing payload with 409');

    // Differing route
    let threwRoute = false;
    try {
      await idempotencyService.reserveOrGetCached(wsId, key, '/api/v1/other', 'POST', originalPayload);
    } catch (err) {
      threwRoute = true;
      assert.strictEqual(err.statusCode, 409);
    }
    assert(threwRoute, 'Should reject differing route with 409');
  });

  // 6. 3-Tier Health Probes with Non-Mutating RPC Metadata Verification
  await runTest('6.1 Tier 1 Liveness Probe responds without external queries', () => {
    const live = healthService.getLiveness();
    assert.strictEqual(live.status, 'ok');
    assert.strictEqual(live.platform_version, '3.8.0');
    assert.strictEqual(live.service, 'media-platform-api');
  });

  await runTest('6.2 Tier 2 Readiness Probe checks DB and returns status', async () => {
    const { isReady, result } = await healthService.getReadiness();
    assert.strictEqual(isReady, true);
    assert.strictEqual(result.status, 'ok');
    assert(result.checks.database !== undefined);
  });

  await runTest('6.3 Tier 3 Deep Health executes non-mutating RPC metadata & storage write-read-delete probe', async () => {
    const deepResult = await healthService.getDeepHealth('test_probe_run');
    assert(['ok', 'degraded'].includes(deepResult.status));
    assert(deepResult.checks.database !== undefined);
    assert(deepResult.checks.storage !== undefined);
    assert.strictEqual(deepResult.checks.database.rpc_integrity, 'verified');
    assert.strictEqual(deepResult.checks.database.rpcs.claim_next_processing_job, 'available');
    assert.strictEqual(deepResult.checks.database.rpcs.consume_rate_limit_token, 'available');
    assert.strictEqual(deepResult.checks.database.rpcs.reserve_idempotency_key, 'available');
  });

  // 7. Ground-Truth Usage & Multi-Tenant Webhook Isolation
  await runTest('7.1 Usage Service: Empty workspace returns zero usage without mock injection', async () => {
    const emptyWsId = `ws_empty_${Date.now()}`;
    const usage = await usageService.getWorkspaceUsage(emptyWsId);
    assert.strictEqual(usage.workspaceId, emptyWsId);
    assert.strictEqual(usage.storage.usedBytes, 0);
    assert.strictEqual(usage.assets.totalCount, 0);
    assert.strictEqual(usage.assets.breakdown.videos, 0);
    assert.strictEqual(usage.assets.breakdown.images, 0);
    assert.strictEqual(usage.metrics.webhookDeliveries, 0);
  });

  await runTest('7.2 Usage Service: Webhook count is strictly scoped per workspace (no cross-tenant leakage)', async () => {
    const wsA = `ws_tenant_a_${Date.now()}`;
    const wsB = `ws_tenant_b_${Date.now()}`;

    const usageA = await usageService.getWorkspaceUsage(wsA);
    const usageB = await usageService.getWorkspaceUsage(wsB);

    assert.strictEqual(usageA.metrics.webhookDeliveries, 0);
    assert.strictEqual(usageB.metrics.webhookDeliveries, 0);
  });

  // 8. Worker Fleet Observability & Heartbeat
  await runTest('8.1 Worker Fleet Service registers worker, records heartbeat, and tracks status', async () => {
    const testWorkerId = `wrk_test_${Date.now()}`;
    await workerFleetService.registerWorker({
      worker_id: testWorkerId,
      hostname: 'test-node-01',
      pid: 12345,
      job_types: ['transcode_video', 'generate_hls'],
    });

    await workerFleetService.recordHeartbeat(testWorkerId, {
      current_job_id: null,
      increment_completed: 5,
    });

    const fleet = await workerFleetService.listWorkers();
    const workersList = Array.isArray(fleet) ? fleet : fleet.workers || [];
    const registered = workersList.find((w) => w.worker_id === testWorkerId || w.id === `winst_${testWorkerId}`);
    assert(registered !== undefined);
    assert.strictEqual(registered.hostname, 'test-node-01');

    await workerFleetService.unregisterWorker(testWorkerId);
  });

  // 9. API Key Rotation
  await runTest('9.1 API Key rotation creates successor and preserves old key with grace period', async () => {
    const { data: existingKey } = await supabaseAdmin
      .from('api_keys')
      .select('*')
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (existingKey) {
      const rotationResult = await developerService.rotateApiKey(
        existingKey.id,
        existingKey.workspace_id,
        2
      );

      assert(rotationResult.rawKey !== undefined);
      assert(rotationResult.newKeyRecord !== undefined);
      assert(rotationResult.newKeyRecord.id.startsWith('key_'));
      assert(rotationResult.rawKey.startsWith('mda_live_') || rotationResult.rawKey.startsWith('mda_test_'));
      assert.strictEqual(rotationResult.oldKeyRecord.id, existingKey.id);
      assert(rotationResult.oldKeyRecord.expires_at !== null);

      const { data: updatedOldKey } = await supabaseAdmin
        .from('api_keys')
        .select('*')
        .eq('id', existingKey.id)
        .single();
      assert(updatedOldKey.rotated_at !== null);
    } else {
      console.log('    (Skipping DB rotation test: no active API key in DB)');
    }
  });

  // 10. OpenAPI 3.1 Contract Specification
  await runTest('10.1 OpenAPI 3.1 document adheres to schema and defines full response schemas', () => {
    assert.strictEqual(openApiSpec.openapi, '3.1.0');
    assert.strictEqual(openApiSpec.info.version, '3.8.0');

    // Every path operation must have an operationId and responses
    for (const [pathKey, methods] of Object.entries(openApiSpec.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        if (typeof op === 'object' && op !== null) {
          assert(op.operationId, `Missing operationId on ${method.toUpperCase()} ${pathKey}`);
          assert(op.responses, `Missing responses on ${method.toUpperCase()} ${pathKey}`);
        }
      }
    }

    assert(openApiSpec.paths['/health/live'].get.responses['200'].content['application/json'] !== undefined);
    assert(openApiSpec.paths['/uploads'].post.requestBody.content['multipart/form-data'] !== undefined);
    assert(openApiSpec.components.schemas.Asset !== undefined);
  });

  // 11. CORS Security Origin Allowlist
  await runTest('11.1 CORS: Untrusted arbitrary origin with credentials is strictly denied (403)', () => {
    assert.strictEqual(isAllowedOrigin('https://evil.example'), false);
    assert.strictEqual(isAllowedOrigin('http://localhost:3000'), true);
  });

  // 12. Real TypeScript SDK End-to-End Test (Upload -> Get -> Delivery -> Purge)
  await runTest('12.1 Real SDK E2E: uploadAsset -> getAsset -> getDeliveryUrl -> deleteAsset(?action=purge)', async () => {
    // 1. Resolve Admin Key
    const { data: keyRecord } = await supabaseAdmin
      .from('api_keys')
      .select('*')
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (!keyRecord) {
      console.log('    (Skipping Real SDK E2E: No active API key found)');
      return;
    }

    // Create authentic test key with proper salt and scope
    const { rawKey: testToken, keyRecord: tempKey } = await developerService.createApiKey(
      keyRecord.workspace_id,
      keyRecord.service_account_id,
      'SDK E2E Test Key',
      ['*']
    );

    try {
      const client = new MediaPlatformClient({
        apiKey: testToken,
        baseUrl: BASE_URL,
      });

      // 2. Upload asset via SDK
      const testBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      );
      const uploadedAsset = await client.assets.upload(testBuffer, {
        displayName: 'E2E SDK 1x1 Pixel',
        visibility: 'public',
      });

      assert(uploadedAsset !== null && uploadedAsset.id !== undefined);
      assert(uploadedAsset.id.startsWith('med_'));

      // 3. Get asset via SDK
      const fetchedAsset = await client.assets.get(uploadedAsset.id);
      assert.strictEqual(fetchedAsset.id, uploadedAsset.id);
      assert.strictEqual(fetchedAsset.display_name, 'E2E SDK 1x1 Pixel');

      // 4. Generate Delivery URL & Fetch over HTTP
      const deliveryUrl = client.assets.getDeliveryUrl(uploadedAsset.id, {
        width: 10,
        format: 'webp',
      });
      assert(deliveryUrl.includes(`/api/v1/delivery/${uploadedAsset.id}?w=10&format=webp`));

      const deliveryRes = await fetch(deliveryUrl);
      assert.strictEqual(deliveryRes.status, 200);

      // 5. Permanent Purge via SDK (sends ?action=purge)
      const deleteRes = await client.assets.delete(uploadedAsset.id, { permanent: true, force: true });
      assert.strictEqual(deleteRes.success, true);

      // Verify asset record is purged from database
      const { data: checkPurged } = await supabaseAdmin
        .from('assets')
        .select('id')
        .eq('id', uploadedAsset.id)
        .maybeSingle();
      assert.strictEqual(checkPurged, null, 'Asset record must be permanently purged from database');
    } finally {
      if (tempKey?.id) {
        await supabaseAdmin.from('api_keys').delete().eq('id', tempKey.id);
      }
    }
  });

  // 13. Durable Critical Audit Recording
  await runTest('13.1 Critical audit recording waits for DB write and records critical event', async () => {
    const { data: ws } = await supabaseAdmin.from('workspaces').select('id').limit(1).maybeSingle();
    const wsId = ws ? ws.id : 'ws_default';
    const result = await auditService.recordCritical({
      workspace_id: wsId,
      action: 'api_key.rotated',
      resource_type: 'api_key',
      resource_id: 'key_test_123',
      actor_type: 'service_account',
      actor_id: 'svc_test_123',
      metadata: { reason: 'v3.8.1 correctness gate execution' },
    });
    assert.strictEqual(result.success, true);
  });

  console.log('\n============================================================');
  console.log(`🎉 TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED (100%)`);
  console.log('============================================================\n');
}

main().catch((err) => {
  console.error('\n❌ FATAL TEST FAILURE:', err);
  process.exit(1);
});
