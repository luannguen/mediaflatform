/**
 * Media Platform v3.8 — Developer Platform & Operational Control Plane Test Suite
 * Comprehensive End-to-End & Integration Test for v3.8 Invariants
 */

const fs = require('fs');
const path = require('path');

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
const assert = require('assert');
const crypto = require('crypto');

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
const { openApiSpec } = require('../src/openapi/spec.ts');
const { MediaPlatformClient, MediaPlatformError } = require('../packages/sdk/index.ts');
const { supabaseAdmin } = require('../src/lib/supabase/admin.ts');

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
  console.log(`🧪 MEDIA PLATFORM v${PLATFORM_VERSION} — CONTROL PLANE & DEVELOPER PLATFORM`);
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

  // 4. Rate Limiting Engine
  await runTest('4.1 Rate limiter correctly classifies routes', () => {
    assert.strictEqual(rateLimiter.classifyRoute('GET', '/api/v1/assets'), 'read');
    assert.strictEqual(rateLimiter.classifyRoute('POST', '/api/v1/assets'), 'write');
    assert.strictEqual(rateLimiter.classifyRoute('POST', '/api/v1/uploads/direct'), 'upload');
    assert.strictEqual(rateLimiter.classifyRoute('GET', '/api/v1/delivery/med_123?w=800'), 'expensive_transform');
    assert.strictEqual(rateLimiter.classifyRoute('GET', '/api/v1/admin/workers'), 'admin');
  });

  await runTest('4.2 Rate limiter decrements tokens and attaches standard headers', async () => {
    const testCaller = `test_caller_${Date.now()}`;
    const firstCheck = await rateLimiter.checkRateLimit(testCaller, 'upload');
    assert.strictEqual(firstCheck.allowed, true);
    assert.strictEqual(firstCheck.limit, 30);
    assert.strictEqual(firstCheck.remaining, 29);

    const headers = rateLimiter.getHeaders(firstCheck);
    assert.strictEqual(headers['RateLimit-Limit'], '30');
    assert.strictEqual(headers['RateLimit-Remaining'], '29');
    assert(headers['RateLimit-Reset'] !== undefined);
  });

  // 5. Idempotency Engine
  await runTest('5.1 Idempotency returns cached result for matching payload', async () => {
    const wsId = 'ws_idemp_test';
    const key = `key_${Date.now()}`;
    const route = '/api/v1/assets';
    const payload = { displayName: 'Original Asset Name' };

    await idempotencyService.saveResponse(wsId, key, route, payload, 201, {}, { asset_id: 'med_cached_1' });

    const cached = await idempotencyService.validateAndGetCached(wsId, key, route, payload);
    assert(cached !== null);
    assert.strictEqual(cached.response_status, 201);
    assert.strictEqual(cached.response_body.asset_id, 'med_cached_1');
  });

  await runTest('5.2 Idempotency throws 409 conflict when payload differs', async () => {
    const wsId = 'ws_idemp_test';
    const key = `key_conflict_${Date.now()}`;
    const route = '/api/v1/assets';
    const originalPayload = { displayName: 'Original' };
    const tamperedPayload = { displayName: 'Tampered' };

    await idempotencyService.saveResponse(wsId, key, route, originalPayload, 200, {}, { done: true });

    let threw = false;
    try {
      await idempotencyService.validateAndGetCached(wsId, key, route, tamperedPayload);
    } catch (err) {
      threw = true;
      assert.strictEqual(err.statusCode, 409);
      assert.strictEqual(err.code, 'IDEMPOTENCY_CONFLICT');
    }
    assert(threw, 'Should have thrown 409 IDEMPOTENCY_CONFLICT');
  });

  // 6. 3-Tier Health Probes
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

  await runTest('6.3 Tier 3 Deep Diagnostic Probe performs write-read-delete probe', async () => {
    const deepResult = await healthService.getDeepHealth('test_probe_run');
    assert(['ok', 'degraded'].includes(deepResult.status));
    assert(deepResult.checks.database !== undefined);
    assert(deepResult.checks.storage !== undefined);
    assert(deepResult.checks.queue !== undefined);
    assert(deepResult.checks.workers !== undefined);
  });

  // 7. Ground-Truth Usage & Zero Fake Telemetry
  await runTest('7.1 Usage Service computes real stats without mock injection', async () => {
    const emptyWsId = `ws_empty_${Date.now()}`;
    const usage = await usageService.getWorkspaceUsage(emptyWsId);
    assert.strictEqual(usage.workspaceId, emptyWsId);
    assert.strictEqual(usage.storage.usedBytes, 0);
    assert.strictEqual(usage.assets.totalCount, 0);
    assert.strictEqual(usage.assets.breakdown.videos, 0);
    assert.strictEqual(usage.assets.breakdown.images, 0);
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

    // Clean up test worker
    await workerFleetService.unregisterWorker(testWorkerId);
  });

  // 9. API Key Rotation
  await runTest('9.1 API Key rotation creates successor and preserves old key with grace period', async () => {
    // Look for an existing API key in db or create a temporary one
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

      // Verify DB record
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
  await runTest('10.1 OpenAPI 3.1 document adheres to schema and contains v3.8 routes', () => {
    assert.strictEqual(openApiSpec.openapi, '3.1.0');
    assert.strictEqual(openApiSpec.info.version, '3.8.0');
    assert(openApiSpec.paths['/health/live'] !== undefined);
    assert(openApiSpec.paths['/health/ready'] !== undefined);
    assert(openApiSpec.paths['/health/deep'] !== undefined);
    assert(openApiSpec.paths['/capabilities'] !== undefined);
    assert(openApiSpec.paths['/usage'] !== undefined);
    assert(openApiSpec.paths['/admin/workers'] !== undefined);
    assert(openApiSpec.paths['/developer/keys/{id}/rotate'] !== undefined);
    assert(openApiSpec.paths['/webhooks/deliveries/{id}/replay'] !== undefined);
    assert(openApiSpec.components.schemas.Asset !== undefined);
    assert(openApiSpec.components.schemas.ErrorResponse !== undefined);
  });

  // 11. Official TypeScript SDK
  await runTest('11.1 TypeScript SDK initializes, generates delivery URLs and handles error types', () => {
    const client = new MediaPlatformClient({
      apiKey: 'mda_live_test_api_key_12345',
      baseUrl: 'http://localhost:3000',
    });

    const deliveryUrl = client.assets.getDeliveryUrl('med_test123', {
      width: 800,
      height: 600,
      format: 'webp',
      quality: 85,
    });

    assert.strictEqual(
      deliveryUrl,
      'http://localhost:3000/api/v1/delivery/med_test123?w=800&h=600&format=webp&q=85'
    );

    const err = new MediaPlatformError('Not found', 'ASSET_NOT_FOUND', 404, 'req_123', { id: 'med_test123' });
    assert.strictEqual(err.code, 'ASSET_NOT_FOUND');
    assert.strictEqual(err.status, 404);
    assert.strictEqual(err.requestId, 'req_123');
  });

  // 12. Durable Critical Audit Recording
  await runTest('12.1 Critical audit recording waits for DB write and records critical event', async () => {
    const { data: ws } = await supabaseAdmin.from('workspaces').select('id').limit(1).maybeSingle();
    const wsId = ws ? ws.id : 'ws_default';
    const result = await auditService.recordCritical({
      workspace_id: wsId,
      action: 'api_key.rotated',
      resource_type: 'api_key',
      resource_id: 'key_test_123',
      actor_type: 'service_account',
      actor_id: 'svc_test_123',
      metadata: { reason: 'v3.8 test suite execution' },
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
