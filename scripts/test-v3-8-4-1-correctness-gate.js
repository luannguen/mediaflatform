const fs = require('fs');
const assert = require('assert');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function mustContain(source, text, message) {
  assert(source.includes(text), message || `Expected source to contain: ${text}`);
}

function mustNotContain(source, text, message) {
  assert(!source.includes(text), message || `Expected source not to contain: ${text}`);
}

const workspaceResolver = read('src/lib/security/workspace-resolver.ts');
const demoRoute = read('src/app/api/v1/demo/session/route.ts');
const uploadService = read('src/services/uploadSessionService.ts');
const storageProvider = read('src/lib/storage/supabase-provider.ts');
const capabilities = read('src/app/api/v1/capabilities/route.ts');
const layout = read('src/app/layout.tsx');
const deliveryGrantRoute = read('src/app/api/v1/assets/[id]/delivery-grant/route.ts');
const session = read('src/lib/auth/session.ts');

const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}

test('runtime workspace auth does not use email fallback', () => {
  mustNotContain(workspaceResolver, ".eq('user_email'");
});

test('multi-workspace resolution requires explicit selection', () => {
  mustContain(workspaceResolver, 'WORKSPACE_SELECTION_REQUIRED');
  mustNotContain(workspaceResolver, 'earliest joined');
});

test('demo broker is fixed least privilege and not client role-selectable', () => {
  mustContain(demoRoute, "const DEMO_ROLE = 'uploader'");
  mustContain(demoRoute, "const DEMO_ROLE_ID = 'role_uploader'");
  mustNotContain(demoRoute, 'body?.role');
  mustNotContain(demoRoute, 'role_admin');
});

test('demo token lifetime is bounded', () => {
  mustContain(demoRoute, 'DEMO_COOKIE_TTL_SECONDS');
  mustContain(demoRoute, 'createSessionToken(');
  mustContain(session, 'maxAgeSeconds');
});

test('direct upload only advertises signed-put until TUS client exists', () => {
  mustContain(uploadService, "preferProtocol: 'signed-put'");
  mustNotContain(storageProvider, "protocol: 'tus'");
  mustNotContain(storageProvider, '/storage/v1/upload/resumable');
  mustContain(capabilities, "direct_upload_protocols: ['signed-put']");
  mustContain(capabilities, 'resumable_upload: false');
});

test('upload session validates folder tenant boundary', () => {
  mustContain(uploadService, 'assertFolderBelongsToWorkspace');
  mustContain(uploadService, 'FOLDER_WORKSPACE_MISMATCH');
});

test('finalize rejects actual-size mismatch', () => {
  mustContain(uploadService, 'metadata.sizeBytes !== session.size_bytes');
  mustContain(uploadService, 'UPLOAD_SIZE_MISMATCH');
});

test('unverified checksum and provider etag are not persisted as verified SHA-256', () => {
  mustContain(uploadService, 'declared_checksum');
  mustContain(uploadService, 'provider_etag');
  mustContain(uploadService, 'p_declared_checksum: null');
});

test('cleanup remains retryable when physical delete fails', () => {
  mustContain(uploadService, "status: 'expired_pending_cleanup'");
  mustContain(uploadService, 'deleted = await storage.delete');
  mustContain(uploadService, 'if (!deleted)');
  mustContain(uploadService, ".is('asset_id', null)");
});

test('delivery grants reject wildcard/client-escalated permissions', () => {
  mustContain(deliveryGrantRoute, "p === '*'");
  mustContain(deliveryGrantRoute, 'allowedGrantPermissions');
  mustContain(deliveryGrantRoute, 'DELIVERY_GRANT_FORBIDDEN');
});

test('production runtime does not monkey-patch browser scheduling APIs', () => {
  mustNotContain(layout, 'requestIdleCallback');
  mustNotContain(layout, 'DevToolsErrorSuppressor');
});

test('session signing fails closed in production and uses WebCrypto verification', () => {
  mustContain(session, "process.env.NODE_ENV === 'production'");
  mustContain(session, 'crypto.subtle.verify');
  mustNotContain(session, 'mda_super_secret_session_key_2026');
});

let passed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    passed++;
    console.log(`✅ ${name}`);
  } catch (err) {
    console.error(`❌ ${name}: ${err.message}`);
    process.exitCode = 1;
  }
}

console.log(`\n${passed}/${tests.length} correctness-gate tests passed.`);
if (passed !== tests.length) process.exit(1);
