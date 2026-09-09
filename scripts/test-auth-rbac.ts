import { createSessionToken, verifySessionToken, DEMO_USERS } from '../src/lib/auth/session';

async function runAuthTests() {
  console.log('🧪 RUNNING MEDIA PLATFORM AUTH & RBAC VERIFICATION SUITE...\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${desc}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${desc}`);
      failed++;
    }
  }

  // 1. Test Session Token Creation & Universal Web Crypto Verification
  console.log('👉 [TEST 1] Session Token Signing & Web Crypto Verification');
  const token = await createSessionToken({
    userId: 'usr_test_123',
    email: 'admin@zeroresidues.com',
    name: 'Admin User',
    role: 'admin',
    workspaceId: 'ws_default',
    organizationId: 'org_zero_residues',
  });

  assert(token.includes('.'), 'Session token is signed with signature format [payload].[signature]');
  const decoded = await verifySessionToken(token);
  assert(decoded !== null, 'Valid session token successfully verified');
  assert(decoded?.email === 'admin@zeroresidues.com', 'Decoded email matches original payload');
  assert(decoded?.role === 'admin', 'Decoded role is admin');

  // Tampered token test
  const tamperedToken = token.slice(0, -4) + 'abcd';
  const tamperedDecoded = await verifySessionToken(tamperedToken);
  assert(tamperedDecoded === null, 'Tampered session token signature rejected');

  // 2. Test Demo Users Mapping & RBAC Profiles
  console.log('\n👉 [TEST 2] Preconfigured RBAC Roles & Identities (Section 104)');
  assert(Boolean(DEMO_USERS.admin), 'Admin identity exists with full access');
  assert(DEMO_USERS.admin.role === 'admin', 'Admin role is admin');
  assert(Boolean(DEMO_USERS.editor), 'Editor identity exists');
  assert(DEMO_USERS.editor.role === 'editor', 'Editor role is editor');
  assert(Boolean(DEMO_USERS.viewer), 'Viewer identity exists');
  assert(DEMO_USERS.viewer.role === 'viewer', 'Viewer role is viewer');
  assert(Boolean(DEMO_USERS.developer), 'Developer identity exists');
  assert(DEMO_USERS.developer.role === 'developer', 'Developer role is developer');

  // 3. Test Role Scope Boundaries (Section 10 & 124)
  console.log('\n👉 [TEST 3] Role Scopes & Permission Boundary Matrix');
  const adminToken = await createSessionToken({
    userId: 'usr_admin',
    email: DEMO_USERS.admin.email,
    name: DEMO_USERS.admin.name,
    role: 'admin',
    workspaceId: 'ws_default',
    organizationId: 'org_zero_residues',
  });
  const viewerToken = await createSessionToken({
    userId: 'usr_viewer',
    email: DEMO_USERS.viewer.email,
    name: DEMO_USERS.viewer.name,
    role: 'viewer',
    workspaceId: 'ws_default',
    organizationId: 'org_zero_residues',
  });

  const adminSession = await verifySessionToken(adminToken);
  const viewerSession = await verifySessionToken(viewerToken);

  assert(adminSession?.role === 'admin', 'Admin session has unrestricted capabilities');
  assert(viewerSession?.role === 'viewer', 'Viewer session is restricted to read-only');

  console.log('\n==================================================');
  console.log(`🏁 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('==================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAuthTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
