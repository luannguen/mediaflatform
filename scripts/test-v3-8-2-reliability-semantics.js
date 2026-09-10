/**
 * Media Platform v3.8.2 — Reliability Semantics Gate Test Suite
 * Failure Injection, Fenced Concurrency, Multi-Tenant Isolation, Real HTTP CORS & Contract Tests
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

// 2. Load platform modules
const { PLATFORM_VERSION, API_VERSION } = require('../src/lib/platform/version.ts');
const { idempotencyService, canonicalizeJson } = require('../src/lib/security/idempotency.ts');
const { rateLimiter, RATE_LIMIT_FAILURE_POLICY } = require('../src/lib/security/rateLimiter.ts');
const {
  healthService,
  validateRuntimeConfiguration,
  aggregateHealthStatus,
  CRITICAL_PLATFORM_RPCS,
} = require('../src/lib/platform/healthService.ts');
const { usageService } = require('../src/services/usageService.ts');
const { developerService } = require('../src/services/developerService.ts');
const { auditService } = require('../src/services/auditService.ts');
const { isAllowedOrigin } = require('../src/lib/security/cors.ts');
const { MediaPlatformClient, MediaPlatformError } = require('../packages/sdk/index.ts');
const { supabaseAdmin } = require('../src/lib/supabase/admin.ts');
const { validateOpenApi } = require('./test-openapi-contract.js');

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
  console.log(`🛡️  MEDIA PLATFORM v${PLATFORM_VERSION} — RELIABILITY SEMANTICS GATE`);
  console.log('============================================================\n');

  // 1. Version Baseline Consistency
  await runTest('1.1 Version baseline: Runtime and API version consistency', () => {
    assert(PLATFORM_VERSION === '3.8.2' || PLATFORM_VERSION === '3.8.3', 'Version must be 3.8.2 or 3.8.3');
    assert.strictEqual(API_VERSION, 'v1');
    const sdkPkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../packages/sdk/package.json'), 'utf8'));
    assert.strictEqual(sdkPkg.version, PLATFORM_VERSION);
    const rootPkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
    assert.strictEqual(rootPkg.version, PLATFORM_VERSION);
  });

  // 2. Canonical JSON Sorting & Deterministic Fingerprinting
  await runTest('2.1 Idempotency: Differing JSON key insertion order produces identical fingerprint', () => {
    const objA = { b: 2, a: 1, c: { y: 'test', x: 42 } };
    const objB = { a: 1, c: { x: 42, y: 'test' }, b: 2 };
    const hashA = idempotencyService.computeFingerprint('POST', '/api/v1/assets', objA);
    const hashB = idempotencyService.computeFingerprint('POST', '/api/v1/assets', objB);
    assert.strictEqual(hashA, hashB, 'Reordered keys must produce identical fingerprint');
  });

  // 3. P0 Idempotency: Must Fail Closed on Subsystem Failure
  await runTest('3.1 P0 Idempotency Fail-Closed: RPC failure strictly returns 503 IDEMPOTENCY_UNAVAILABLE', async () => {
    const wsId = 'ws_fail_closed_test';
    const key = `key_fail_closed_${Date.now()}`;
    let businessLogicExecuted = false;

    // Simulate database failure by stubbing rpc temporarily
    const originalRpc = supabaseAdmin.rpc;
    supabaseAdmin.rpc = async (fnName) => {
      if (fnName === 'reserve_idempotency_key') {
        throw new Error('Connection to PostgreSQL rate/idempotency replica timed out');
      }
      return originalRpc.apply(supabaseAdmin, arguments);
    };

    try {
      try {
        await idempotencyService.reserveOrGetCached(wsId, key, '/api/v1/assets', 'POST', { test: true });
        businessLogicExecuted = true;
      } catch (err) {
        assert.strictEqual(err.statusCode, 503, 'Must return HTTP 503');
        assert.strictEqual(err.code, 'IDEMPOTENCY_UNAVAILABLE', 'Must use IDEMPOTENCY_UNAVAILABLE code');
      }
      assert.strictEqual(businessLogicExecuted, false, 'Business logic must NEVER execute when idempotency subsystem is down');
    } finally {
      supabaseAdmin.rpc = originalRpc;
    }
  });

  // 4. P0 Idempotency: Execution Token & Zombie Completion Fencing
  await runTest('4.1 P0 Idempotency Fencing: Stale/zombie worker completion is rejected (RESERVATION_LOST)', async () => {
    const wsId = 'ws_fencing_test';
    const key = `key_zombie_${Date.now()}`;
    const route = '/api/v1/assets';
    const payload = { file: 'video.mp4' };

    // Worker A reserves with a short 2-second lease
    const resA = await idempotencyService.reserveOrGetCached(wsId, key, route, 'POST', payload, 24, 2);
    assert.strictEqual(resA.action, 'execute');
    assert(resA.executionToken !== undefined);
    const tokenA = resA.executionToken;

    // Wait 2.5 seconds for Worker A lease to expire
    await new Promise((r) => setTimeout(r, 2500));

    // Worker B takes over expired lease
    const resB = await idempotencyService.reserveOrGetCached(wsId, key, route, 'POST', payload, 24, 60);
    assert.strictEqual(resB.action, 'execute');
    assert(resB.executionToken !== undefined);
    assert.notStrictEqual(resB.executionToken, tokenA, 'Worker B must receive a new execution token');
    const tokenB = resB.executionToken;

    // Stale Worker A attempts to complete the request
    const completeA = await idempotencyService.saveResponse(
      wsId,
      key,
      route,
      payload,
      200,
      { 'content-type': 'application/json' },
      { id: 'asset_from_worker_a' },
      24,
      tokenA
    );
    assert.strictEqual(completeA.success, false, 'Worker A completion must be rejected');
    assert.strictEqual(completeA.reason, 'RESERVATION_LOST', 'Reason must be RESERVATION_LOST');

    // Legitimate Worker B completes the request
    const completeB = await idempotencyService.saveResponse(
      wsId,
      key,
      route,
      payload,
      201,
      { 'content-type': 'application/json' },
      { id: 'asset_from_worker_b' },
      24,
      tokenB
    );
    assert.strictEqual(completeB.success, true, 'Worker B completion must succeed');

    // Subsequent request must receive Worker B result, NOT Worker A
    const resCached = await idempotencyService.reserveOrGetCached(wsId, key, route, 'POST', payload);
    assert.strictEqual(resCached.action, 'cached');
    assert.strictEqual(resCached.cachedRecord?.response_status, 201);
    assert.strictEqual(resCached.cachedRecord?.response_body.id, 'asset_from_worker_b');

    // Cleanup
    await supabaseAdmin.from('idempotency_records').delete().eq('workspace_id', wsId).eq('idempotency_key', key);
  });

  // 5. P0 Idempotency: Zombie Failure Fencing
  await runTest('5.1 P0 Idempotency Fencing: Stale worker cannot mark new owner reservation FAILED', async () => {
    const wsId = 'ws_fencing_fail_test';
    const key = `key_zombie_fail_${Date.now()}`;
    const route = '/api/v1/assets';
    const payload = { file: 'doc.pdf' };

    // Worker A reserves with 2s lease
    const resA = await idempotencyService.reserveOrGetCached(wsId, key, route, 'POST', payload, 24, 2);
    const tokenA = resA.executionToken;

    // Lease expires
    await new Promise((r) => setTimeout(r, 2500));

    // Worker B takes over
    const resB = await idempotencyService.reserveOrGetCached(wsId, key, route, 'POST', payload, 24, 60);
    const tokenB = resB.executionToken;

    // Stale Worker A attempts to mark request failed
    const failA = await idempotencyService.markFailed(wsId, key, tokenA);
    assert.strictEqual(failA.success, false);
    assert.strictEqual(failA.reason, 'RESERVATION_LOST');

    // Verify record is still PENDING under Worker B
    const { data: rec } = await supabaseAdmin
      .from('idempotency_records')
      .select('status, execution_token')
      .eq('workspace_id', wsId)
      .eq('idempotency_key', key)
      .single();
    assert.strictEqual(rec.status, 'PENDING');
    assert.strictEqual(rec.execution_token, tokenB);

    // Cleanup
    await supabaseAdmin.from('idempotency_records').delete().eq('workspace_id', wsId).eq('idempotency_key', key);
  });

  // 6. P0 Idempotency: High-Concurrency Race Condition
  await runTest('6.1 P0 Idempotency Concurrency: 20 concurrent requests allow exactly 1 execution', async () => {
    const wsId = 'ws_concurrency_race';
    const key = `key_concurrent_${Date.now()}`;
    const route = '/api/v1/assets';
    const payload = { test: 'concurrent_race' };

    const promises = Array.from({ length: 20 }, () =>
      idempotencyService
        .reserveOrGetCached(wsId, key, route, 'POST', payload)
        .then((res) => ({ status: 'success', res }))
        .catch((err) => ({ status: 'error', error: err }))
    );

    const results = await Promise.all(promises);
    const executed = results.filter((r) => r.status === 'success' && r.res.action === 'execute');
    const inProgress = results.filter((r) => r.status === 'error' && r.error.code === 'IDEMPOTENCY_CONFLICT');

    assert.strictEqual(executed.length, 1, `Expected exactly 1 execution, got ${executed.length}`);
    assert.strictEqual(inProgress.length, 19, `Expected 19 in_progress conflicts, got ${inProgress.length}`);
    assert(executed[0].res.executionToken.startsWith('idemrun_'));

    // Complete winning execution
    await idempotencyService.saveResponse(
      wsId,
      key,
      route,
      payload,
      200,
      { 'content-type': 'application/json' },
      { id: 'winner_asset' },
      24,
      executed[0].res.executionToken
    );

    // Verify cache hit
    const cached = await idempotencyService.reserveOrGetCached(wsId, key, route, 'POST', payload);
    assert.strictEqual(cached.action, 'cached');

    // Cleanup
    await supabaseAdmin.from('idempotency_records').delete().eq('workspace_id', wsId).eq('idempotency_key', key);
  });

  // 7. P0 Rate Limiter: Route Classification with Query Params
  await runTest('7.1 Rate Limiter: Classifies expensive transforms and uploads with query params', () => {
    assert.strictEqual(rateLimiter.classifyRoute('POST', '/api/v1/uploads'), 'upload');
    assert.strictEqual(rateLimiter.classifyRoute('GET', '/api/v1/delivery/med_123?w=800'), 'expensive_transform');
    assert.strictEqual(rateLimiter.classifyRoute('GET', '/api/v1/delivery/med_123', new URLSearchParams('format=webp')), 'expensive_transform');
    assert.strictEqual(rateLimiter.classifyRoute('GET', '/api/v1/assets'), 'read');
    assert.strictEqual(rateLimiter.classifyRoute('POST', '/api/v1/assets'), 'write');
    assert.strictEqual(rateLimiter.classifyRoute('GET', '/api/v1/admin/workers'), 'admin');
  });

  // 8. P0 Rate Limiter: High-Concurrency PostgreSQL Serialization
  await runTest('8.1 Rate Limiter Concurrency: 60 concurrent requests vs limit=30 strictly rejects 30', async () => {
    const caller = `caller_concurrency_${Date.now()}`;
    const totalRequests = 60;
    const limit = 30;

    const promises = Array.from({ length: totalRequests }, () => rateLimiter.checkRateLimit(caller, 'upload'));
    const results = await Promise.all(promises);

    const allowed = results.filter((r) => r.allowed).length;
    const rejected = results.filter((r) => !r.allowed).length;

    assert.strictEqual(allowed, limit, `Expected exactly ${limit} allowed, got ${allowed}`);
    assert.strictEqual(rejected, totalRequests - limit, `Expected ${totalRequests - limit} rejected, got ${rejected}`);

    const rejectedResult = results.find((r) => !r.allowed);
    const headers = rateLimiter.getHeaders(rejectedResult);
    assert.strictEqual(headers['RateLimit-Remaining'], '0');
    assert(headers['Retry-After'] !== undefined);
  });

  // 9. P0 Rate Limiter: Failure Policy (Fail Closed vs Fail Open)
  await runTest('9.1 P0 Rate Limiter: Failure policy strictly fails closed for mutations and transforms', async () => {
    // Stub RPC to simulate database outage
    const originalRpc = supabaseAdmin.rpc;
    supabaseAdmin.rpc = async (fnName) => {
      if (fnName === 'consume_rate_limit_token') {
        throw new Error('Database cluster unavailable');
      }
      return originalRpc.apply(supabaseAdmin, arguments);
    };

    try {
      // 1. Upload / Write / Expensive -> MUST FAIL CLOSED
      const writeResult = await rateLimiter.checkRateLimit('caller_test_down', 'upload');
      assert.strictEqual(writeResult.allowed, false, 'Upload must fail-closed on limiter outage');
      assert.strictEqual(writeResult.error, 'RATE_LIMIT_UNAVAILABLE');
      assert.strictEqual(writeResult.enforcement, 'degraded');

      const transformResult = await rateLimiter.checkRateLimit('caller_test_down', 'expensive_transform');
      assert.strictEqual(transformResult.allowed, false, 'Expensive transform must fail-closed');

      // 2. Read -> FAILS OPEN with degraded enforcement header
      const readResult = await rateLimiter.checkRateLimit('caller_test_down', 'read');
      assert.strictEqual(readResult.allowed, true, 'Read may fail-open to preserve public availability');
      assert.strictEqual(readResult.enforcement, 'degraded');

      const headers = rateLimiter.getHeaders(readResult);
      assert.strictEqual(headers['X-RateLimit-Enforcement'], 'degraded');
    } finally {
      supabaseAdmin.rpc = originalRpc;
    }
  });

  // 10. P0 Health: Mandatory Production Configuration Validation
  await runTest('10.1 P0 Health: Production missing database/storage configuration returns NOT_READY', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    try {
      process.env.NODE_ENV = 'production';
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;

      const config = validateRuntimeConfiguration();
      assert.strictEqual(config.isProduction, true);
      assert.strictEqual(config.valid, false);
      assert(config.missing.includes('SUPABASE_SERVICE_ROLE_KEY'));

      const readiness = await healthService.getReadiness();
      assert.strictEqual(readiness.isReady, false);
      assert.strictEqual(readiness.result.status, 'not_ready');
      assert.strictEqual(readiness.result.checks.configuration.status, 'failed');

      const deep = await healthService.getDeepHealth('test_probe');
      assert.strictEqual(deep.status, 'failed');
      assert.strictEqual(deep.checks.configuration.status, 'failed');
    } finally {
      process.env.NODE_ENV = originalEnv;
      process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    }
  });

  // 11. P0 Health: Deterministic Subsystem Status Aggregation
  await runTest('11.1 P0 Health: Subsystem degradation correctly bubbles up to overall status', () => {
    // 1. Healthy
    const okChecks = {
      database: { status: 'ok', rpc_integrity: 'verified' },
      storage: { status: 'ok' },
      queue: { status: 'ok', queued: 0 },
      workers: { online_workers: 2 },
    };
    assert.strictEqual(aggregateHealthStatus(okChecks), 'ok');

    // 2. Zero workers but zero queue -> warning, overall remains OK
    const idleChecks = {
      database: { status: 'ok', rpc_integrity: 'verified' },
      storage: { status: 'ok' },
      queue: { status: 'ok', queued: 0 },
      workers: { online_workers: 0 },
    };
    assert.strictEqual(aggregateHealthStatus(idleChecks), 'ok');

    // 3. Stalled queue: Queued jobs exist (>0) but NO workers online -> degraded
    const stalledChecks = {
      database: { status: 'ok', rpc_integrity: 'verified' },
      storage: { status: 'ok' },
      queue: { status: 'ok', queued: 5 },
      workers: { online_workers: 0 },
    };
    assert.strictEqual(aggregateHealthStatus(stalledChecks), 'degraded');

    // 4. Queue degraded (e.g. DLQ spike) -> degraded
    const dlqChecks = {
      database: { status: 'ok', rpc_integrity: 'verified' },
      storage: { status: 'ok' },
      queue: { status: 'degraded', queued: 0, dead_letter: 15 },
      workers: { online_workers: 2 },
    };
    assert.strictEqual(aggregateHealthStatus(dlqChecks), 'degraded');

    // 5. RPC degraded -> degraded
    const rpcDegradedChecks = {
      database: { status: 'ok', rpc_integrity: 'degraded' },
      storage: { status: 'ok' },
      queue: { status: 'ok' },
      workers: { online_workers: 1 },
    };
    assert.strictEqual(aggregateHealthStatus(rpcDegradedChecks), 'degraded');

    // 6. Hard DB or storage failure -> failed
    const dbFailedChecks = {
      database: { status: 'failed' },
      storage: { status: 'ok' },
    };
    assert.strictEqual(aggregateHealthStatus(dbFailedChecks), 'failed');
  });

  // 12. P0 Health: Non-Mutating Signature-Aware Critical RPC Probe
  await runTest('12.1 Health Probe: verify_platform_rpcs inspects all 8 critical RPC signatures', async () => {
    const { data: rpcStatus, error } = await supabaseAdmin.rpc('verify_platform_rpcs');
    assert.strictEqual(error, null);
    assert(rpcStatus !== null);

    for (const rpc of CRITICAL_PLATFORM_RPCS) {
      assert.strictEqual(rpcStatus[rpc.name], 'available', `Critical RPC "${rpc.name}" must be verified available`);
    }
  });

  // 13. P0 Health: Storage Write-Read-Delete Probe
  await runTest('13.1 Health Probe: Storage write-read-delete probe verifies real storage I/O', async () => {
    const deep = await healthService.getDeepHealth('test_probe_storage');
    assert(['ok', 'degraded'].includes(deep.status));
    assert.strictEqual(deep.checks.storage.probe, 'write_read_delete_verified');
    assert.strictEqual(deep.checks.storage.status, 'ok');
  });

  // 14. P1 Tenancy: Real Cross-Tenant Webhook Usage Fixture Isolation
  await runTest('14.1 P1 Multi-Tenant Usage: Webhook usage strictly isolated per tenant (A=3, B=7, No leak)', async () => {
    const wsA = `ws_tenant_a_${Date.now()}`;
    const wsB = `ws_tenant_b_${Date.now()}`;
    const epA = `wh_ep_a_${Date.now()}`;
    const epB = `wh_ep_b_${Date.now()}`;

    // Create 2 distinct workspaces
    const wsRes = await supabaseAdmin.from('workspaces').insert([
      { id: wsA, organization_id: 'org_default', name: 'Tenant A', slug: `tenant-a-${Date.now()}` },
      { id: wsB, organization_id: 'org_default', name: 'Tenant B', slug: `tenant-b-${Date.now()}` },
    ]);
    if (wsRes.error) throw wsRes.error;

    // Create endpoints for each workspace
    const epRes = await supabaseAdmin.from('webhook_endpoints').insert([
      { id: epA, workspace_id: wsA, name: 'Endpoint A', url: 'https://tenant-a.com/wh', events: ['asset.ready'], secret_hash: 'sec_a' },
      { id: epB, workspace_id: wsB, name: 'Endpoint B', url: 'https://tenant-b.com/wh', events: ['asset.ready'], secret_hash: 'sec_b' },
    ]);
    if (epRes.error) throw epRes.error;

    // Insert 3 deliveries for Tenant A, 7 deliveries for Tenant B
    const deliveriesA = Array.from({ length: 3 }, (_, i) => ({
      id: `wh_del_a_${i}_${Date.now()}`,
      webhook_endpoint_id: epA,
      event_id: `evt_a_${i}_${Date.now()}`,
      event_type: 'asset.ready',
      payload: { id: `med_a_${i}` },
      http_status: 200,
      status: 'delivered',
      attempt_count: 1,
      created_at: new Date().toISOString(),
    }));

    const deliveriesB = Array.from({ length: 7 }, (_, i) => ({
      id: `wh_del_b_${i}_${Date.now()}`,
      webhook_endpoint_id: epB,
      event_id: `evt_b_${i}_${Date.now()}`,
      event_type: 'asset.ready',
      payload: { id: `med_b_${i}` },
      http_status: 200,
      status: 'delivered',
      attempt_count: 1,
      created_at: new Date().toISOString(),
    }));

    const delRes = await supabaseAdmin.from('webhook_deliveries').insert([...deliveriesA, ...deliveriesB]);
    if (delRes.error) throw delRes.error;

    try {
      const usageA = await usageService.getWorkspaceUsage(wsA);
      const usageB = await usageService.getWorkspaceUsage(wsB);

      assert.strictEqual(usageA.metrics.webhookDeliveries, 3, `Tenant A must see exactly 3 deliveries, got ${usageA.metrics.webhookDeliveries}`);
      assert.strictEqual(usageB.metrics.webhookDeliveries, 7, `Tenant B must see exactly 7 deliveries, got ${usageB.metrics.webhookDeliveries}`);
      assert.notStrictEqual(usageA.metrics.webhookDeliveries, 10, 'Tenant A must NOT see total aggregated count');
      assert.notStrictEqual(usageB.metrics.webhookDeliveries, 10, 'Tenant B must NOT see total aggregated count');
    } finally {
      // Clean up all fixtures
      await supabaseAdmin.from('webhook_deliveries').delete().in('webhook_endpoint_id', [epA, epB]);
      await supabaseAdmin.from('webhook_endpoints').delete().in('id', [epA, epB]);
      await supabaseAdmin.from('workspaces').delete().in('id', [wsA, wsB]);
    }
  });

  // 15. P1 CORS: Real HTTP E2E on Next.js Server
  await runTest('15.1 P1 CORS: Real HTTP preflight and GET tests across protected and public routes', async () => {
    // 1. OPTIONS /api/v1/assets with evil origin -> 403 CORS_ORIGIN_DENIED
    const evilOptionsRes = await fetch(`${BASE_URL}/api/v1/assets`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.attacker.example',
        'Access-Control-Request-Method': 'GET',
      },
    });
    assert.strictEqual(evilOptionsRes.status, 403);
    const evilBody = await evilOptionsRes.json();
    assert.strictEqual(evilBody.error.code, 'CORS_ORIGIN_DENIED');

    // 2. OPTIONS /api/v1/assets with allowed origin -> 204 with credentials
    const allowedOptionsRes = await fetch(`${BASE_URL}/api/v1/assets`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3000',
        'Access-Control-Request-Method': 'GET',
      },
    });
    assert.strictEqual(allowedOptionsRes.status, 204);
    assert.strictEqual(allowedOptionsRes.headers.get('Access-Control-Allow-Origin'), 'http://localhost:3000');
    assert.strictEqual(allowedOptionsRes.headers.get('Access-Control-Allow-Credentials'), 'true');

    // 3. OPTIONS /api/v1/delivery/med_sample -> Wildcard without credentials
    const deliveryOptionsRes = await fetch(`${BASE_URL}/api/v1/delivery/med_sample`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://external-client.com',
        'Access-Control-Request-Method': 'GET',
      },
    });
    assert.strictEqual(deliveryOptionsRes.status, 204);
    assert.strictEqual(deliveryOptionsRes.headers.get('Access-Control-Allow-Origin'), '*');
    assert.strictEqual(deliveryOptionsRes.headers.get('Access-Control-Allow-Credentials'), null);
  });

  // 16. P1 Contract: OpenAPI 3.1 Schema & OperationId Uniqueness
  await runTest('16.1 OpenAPI 3.1: Spec validates with parser and has unique operationIds', async () => {
    await validateOpenApi();
  });

  // 17. P1 Real SDK E2E: Upload -> Get -> Delivery -> Purge
  await runTest('17.1 Real SDK E2E: uploadAsset -> getAsset -> getDeliveryUrl -> deleteAsset(?action=purge)', async () => {
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

    const { rawKey: testToken, keyRecord: tempKey } = await developerService.createApiKey(
      keyRecord.workspace_id,
      keyRecord.service_account_id,
      'SDK E2E Test Key v3.8.2',
      ['*']
    );

    try {
      const client = new MediaPlatformClient({
        apiKey: testToken,
        baseUrl: BASE_URL,
      });

      const testBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      );
      const uploadedAsset = await client.assets.upload(testBuffer, {
        displayName: 'E2E SDK Reliability Pixel',
        visibility: 'public',
      });

      assert(uploadedAsset !== null && uploadedAsset.id !== undefined);
      assert(uploadedAsset.id.startsWith('med_'));

      const fetchedAsset = await client.assets.get(uploadedAsset.id);
      assert.strictEqual(fetchedAsset.id, uploadedAsset.id);

      const deliveryUrl = client.assets.getDeliveryUrl(uploadedAsset.id, { width: 10, format: 'webp' });
      const deliveryRes = await fetch(deliveryUrl);
      assert.strictEqual(deliveryRes.status, 200);

      const deleteRes = await client.assets.delete(uploadedAsset.id, { permanent: true, force: true });
      assert.strictEqual(deleteRes.success, true);

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

  // 18. P1 Critical Audit Persistence
  await runTest('18.1 Critical audit recording waits for DB write and records critical event', async () => {
    const { data: ws } = await supabaseAdmin.from('workspaces').select('id').limit(1).maybeSingle();
    const wsId = ws ? ws.id : 'ws_default';
    const result = await auditService.recordCritical({
      workspace_id: wsId,
      action: 'api_key.rotated',
      resource_type: 'api_key',
      resource_id: 'key_test_v3_8_2',
      actor_type: 'service_account',
      actor_id: 'svc_test_123',
      metadata: { reason: 'v3.8.2 reliability gate execution' },
    });
    assert.strictEqual(result.success, true);
  });

  console.log('\n============================================================');
  console.log(`🎉 RELIABILITY TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED (100%)`);
  console.log('============================================================\n');
}

main().catch((err) => {
  console.error('\n❌ FATAL RELIABILITY TEST FAILURE:', err);
  process.exit(1);
});
