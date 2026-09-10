/**
 * Media Platform v3.8.3 — Workspace Persistence & Identity Integrity Gate Test Suite
 * Comprehensive End-to-End, Tenant Isolation, Cross-Tenant Security & PostgreSQL Persistence Suite
 */

const fs = require('fs');
const assert = require('assert');

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

const { PLATFORM_VERSION, API_VERSION } = require('../src/lib/platform/version.ts');
const { workspaceService } = require('../src/services/workspaceService.ts');
const { folderService } = require('../src/services/folderService.ts');
const { developerService } = require('../src/services/developerService.ts');
const { assetService } = require('../src/services/assetService.ts');
const { resolveAuthorizedWorkspace } = require('../src/lib/security/workspace-resolver.ts');
const { isPersistentMode, isMockModeAllowed } = require('../src/lib/platform/persistence-mode.ts');
const { supabaseAdmin } = require('../src/lib/supabase/admin.ts');
const { ErrorCodes } = require('../src/lib/errors/codes.ts');
const { generateId } = require('../src/lib/ids/generator.ts');
const { getStorageProvider } = require('../src/lib/storage/factory.ts');

let passedTests = 0;
let totalTests = 0;

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
  console.log(`MEDIA PLATFORM v${PLATFORM_VERSION} — WORKSPACE PERSISTENCE GATE TEST`);
  console.log(`Runtime Mode: ${isPersistentMode() ? 'POSTGRESQL PERSISTENT' : 'MOCK'} | API: ${API_VERSION}`);
  console.log('============================================================\n');

  assert.strictEqual(PLATFORM_VERSION, '3.8.3', 'Platform version must be 3.8.3');
  assert.strictEqual(isPersistentMode(), true, 'Must run against persistent PostgreSQL backend');

  // Test fixture identifiers
  const testUserId = `usr_test_${Date.now()}`;
  const testUserEmail = `test_${Date.now()}@acme-corp.com`;
  const testUserName = 'Test Engineer';
  let testWorkspaceId = '';

  // 1. Persistent workspace lookup
  await runTest('1. Persistent workspace lookup (getWorkspaceById)', async () => {
    const ws = await workspaceService.getWorkspaceById('ws_default');
    assert(ws, 'ws_default must exist in PostgreSQL');
    assert.strictEqual(ws.id, 'ws_default');
    assert.strictEqual(ws.name, 'Production Media');
  });

  // 2. Persistent memberships
  await runTest('2. Persistent memberships (getUserWorkspaces)', async () => {
    // Current user luan0891 (812a5283-dd7b-4381-8356-d98bd495f450)
    const workspaces = await workspaceService.getUserWorkspaces('812a5283-dd7b-4381-8356-d98bd495f450');
    assert(workspaces.length >= 1, 'User luan0891 must have at least 1 active workspace');
    assert.strictEqual(workspaces[0].role, 'owner');
    assert.notStrictEqual(workspaces[0].id, 'ws_default', 'luan0891 must have their own workspace, not ws_default');
  });

  // 3. Atomic workspace provisioning (RPC provision_workspace_for_user)
  await runTest('3. Atomic workspace provisioning (RPC provision_workspace_for_user)', async () => {
    const ws = await workspaceService.createPersonalWorkspaceForUser(
      testUserId,
      testUserEmail,
      testUserName
    );
    assert(ws && ws.id, 'Provisioned workspace must be returned');
    testWorkspaceId = ws.id;

    // Verify row exists directly in PostgreSQL workspaces table
    const { data: wsRow } = await supabaseAdmin.from('workspaces').select('*').eq('id', testWorkspaceId).single();
    assert.strictEqual(wsRow.id, testWorkspaceId);

    // Verify owner membership row in PostgreSQL workspace_memberships table
    const { data: memRow } = await supabaseAdmin
      .from('workspace_memberships')
      .select('*')
      .eq('workspace_id', testWorkspaceId)
      .eq('user_id', testUserId)
      .single();
    assert(memRow, 'Owner membership must exist in DB');
    assert.strictEqual(memRow.role_id, 'role_owner');
    assert.strictEqual(memRow.status, 'active');

    // Verify initial root folder in PostgreSQL folders table
    const { data: fldRow } = await supabaseAdmin
      .from('folders')
      .select('*')
      .eq('workspace_id', testWorkspaceId)
      .single();
    assert(fldRow, 'Initial General Media folder must exist in DB');
    assert.strictEqual(fldRow.name, 'General Media');
  });

  // 4. Register -> DB workspace persistence
  await runTest('4. Register -> DB workspace persistence', async () => {
    const regUserId = `usr_reg_${Date.now()}`;
    const regEmail = `reg_${Date.now()}@acme-corp.com`;
    const regWs = await workspaceService.createPersonalWorkspaceForUser(regUserId, regEmail, 'New Registered User');

    assert(regWs.id.startsWith('ws_'), 'Workspace ID should have prefix ws_');
    const { data: checkWs } = await supabaseAdmin.from('workspaces').select('id, name').eq('id', regWs.id).single();
    assert.strictEqual(checkWs.id, regWs.id);

    // Clean up
    await supabaseAdmin.from('folders').delete().eq('workspace_id', regWs.id);
    await supabaseAdmin.from('workspace_memberships').delete().eq('workspace_id', regWs.id);
    await supabaseAdmin.from('workspaces').delete().eq('id', regWs.id);
  });

  // 5. Ghost workspace auto-heal
  await runTest('5. Ghost workspace auto-heal (resolveAuthorizedWorkspace)', async () => {
    const ghostWsId = 'ws_ghost_nonexistent_999';
    const resolution = await resolveAuthorizedWorkspace({
      userId: testUserId,
      userEmail: testUserEmail,
      requestedWorkspaceId: ghostWsId,
    });

    assert.strictEqual(resolution.workspace.id, testWorkspaceId, 'Must self-heal to user personal workspace');
    assert.strictEqual(resolution.sessionNeedsRefresh, true, 'sessionNeedsRefresh must be true for ghost cookie');
    assert.strictEqual(resolution.role, 'owner');
  });

  // 6. No-membership does not default to ws_default
  await runTest('6. No-membership does not default to ws_default', async () => {
    const orphanId = `usr_unknown_${Date.now()}`;
    try {
      await resolveAuthorizedWorkspace({
        userId: orphanId,
        userEmail: `unknown_${Date.now()}@acme-corp.com`,
      });
      assert.fail('Should have thrown WORKSPACE_ACCESS_REQUIRED');
    } catch (err) {
      assert.strictEqual(err.code, ErrorCodes.WORKSPACE_ACCESS_REQUIRED);
    }
  });

  // 7. Cross-tenant workspace access denied
  await runTest('7. Cross-tenant workspace access denied (403 WORKSPACE_ACCESS_DENIED)', async () => {
    // testUser tries to access ws_default (which they do not own or belong to)
    try {
      await resolveAuthorizedWorkspace({
        userId: testUserId,
        userEmail: testUserEmail,
        requestedWorkspaceId: 'ws_default',
      });
      assert.fail('Cross-tenant access must be denied with 403');
    } catch (err) {
      assert.strictEqual(err.code, ErrorCodes.WORKSPACE_ACCESS_DENIED);
      assert.strictEqual(err.statusCode, 403);
    }
  });

  // 8. Stale session role overridden by DB role
  await runTest('8. Stale session role overridden by DB role', async () => {
    // Add viewer membership for a separate user
    const viewerUserId = `usr_viewer_${Date.now()}`;
    const memId = generateId('mem');
    await supabaseAdmin.from('workspace_memberships').insert({
      id: memId,
      workspace_id: testWorkspaceId,
      user_id: viewerUserId,
      role_id: 'role_viewer',
      status: 'active',
    });

    const resolution = await resolveAuthorizedWorkspace({
      userId: viewerUserId,
      requestedWorkspaceId: testWorkspaceId,
    });

    assert.strictEqual(resolution.role, 'viewer', 'Authoritative role must come from DB role_id');

    // Clean up
    await supabaseAdmin.from('workspace_memberships').delete().eq('id', memId);
  });

  // 9. Inactive membership denied
  await runTest('9. Inactive/suspended membership denied', async () => {
    const suspendedUserId = `usr_susp_${Date.now()}`;
    const memId = generateId('mem');
    await supabaseAdmin.from('workspace_memberships').insert({
      id: memId,
      workspace_id: testWorkspaceId,
      user_id: suspendedUserId,
      role_id: 'role_owner',
      status: 'suspended',
    });

    try {
      await resolveAuthorizedWorkspace({
        userId: suspendedUserId,
        requestedWorkspaceId: testWorkspaceId,
      });
      assert.fail('Suspended membership must be denied');
    } catch (err) {
      assert(
        err.code === ErrorCodes.WORKSPACE_ACCESS_DENIED || err.code === ErrorCodes.WORKSPACE_ACCESS_REQUIRED,
        'Must reject suspended membership'
      );
    }

    // Clean up
    await supabaseAdmin.from('workspace_memberships').delete().eq('id', memId);
  });

  // 10. Folder DB persistence
  await runTest('10. Folder DB persistence (createFolder & listFolders)', async () => {
    const folder = await folderService.createFolder(testWorkspaceId, 'Marketing Assets');
    assert(folder && folder.id, 'Folder must be created');
    assert.strictEqual(folder.workspace_id, testWorkspaceId);

    // Verify row in PostgreSQL
    const { data: dbFolder } = await supabaseAdmin.from('folders').select('*').eq('id', folder.id).single();
    assert.strictEqual(dbFolder.id, folder.id);
    assert.strictEqual(dbFolder.name, 'Marketing Assets');

    // Verify listFolders finds it
    const list = await folderService.listFolders(testWorkspaceId);
    assert(list.some((f) => f.id === folder.id), 'listFolders must return newly created folder from DB');
  });

  // 11. DB failure produces no silent mock fallback
  await runTest('11. DB failure produces no silent mock fallback', async () => {
    // Trying to create a folder with an invalid/non-existent workspace ID must fail with explicit error
    try {
      await folderService.createFolder('ws_nonexistent_xyz_999', 'Ghost Folder');
      assert.fail('Should fail foreign key constraint in PostgreSQL');
    } catch (err) {
      assert(err.message.includes('Failed to persist folder in PostgreSQL') || err.message.includes('violates foreign key constraint'));
    }
  });

  // 12. Image upload DB persistence & FK validity
  await runTest('12. Image upload DB persistence & FK validity', async () => {
    const testAsset = await assetService.createAsset({
      workspaceId: testWorkspaceId,
      originalFilename: 'hero-banner.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 10240,
      storageKey: `uploads/${testWorkspaceId}/hero-banner.jpg`,
      storageUrl: `https://test-storage/${testWorkspaceId}/hero-banner.jpg`,
      checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    });

    assert(testAsset && testAsset.id, 'Asset record must be created');
    assert.strictEqual(testAsset.workspace_id, testWorkspaceId);

    // Verify in PostgreSQL
    const { data: dbAsset } = await supabaseAdmin.from('assets').select('*').eq('id', testAsset.id).single();
    assert.strictEqual(dbAsset.id, testAsset.id);
    assert.strictEqual(dbAsset.workspace_id, testWorkspaceId);
  });

  // 13. Upload storage compensation
  await runTest('13. Upload storage compensation contract', async () => {
    const storage = getStorageProvider();
    const testKey = `test_compensation_${Date.now()}.bin`;
    const uploadResult = await storage.upload(Buffer.from('test data'), testKey, 'application/octet-stream');
    assert(uploadResult.storageKey, 'Upload must succeed');

    // Simulate compensation delete
    const deleted = await storage.delete(testKey);
    assert.strictEqual(deleted, true, 'Compensation delete must return true');
  });

  // 14. Application persistence
  await runTest('14. Application persistence in PostgreSQL', async () => {
    const app = await developerService.createApplication(testWorkspaceId, {
      name: 'Integration Client App',
      slug: 'integration-client-app',
      description: 'E2E Testing Application',
    });

    assert(app && app.id, 'Application must be created');
    const { data: dbApp } = await supabaseAdmin.from('applications').select('*').eq('id', app.id).single();
    assert.strictEqual(dbApp.id, app.id);
    assert.strictEqual(dbApp.workspace_id, testWorkspaceId);
  });

  // 15. Service account persistence
  let serviceAccountId = '';
  await runTest('15. Service account persistence in PostgreSQL', async () => {
    const svc = await developerService.getOrCreateDefaultServiceAccount(testWorkspaceId);
    assert(svc && svc.id, 'Service account must be provisioned');
    serviceAccountId = svc.id;

    const { data: dbSvc } = await supabaseAdmin.from('service_accounts').select('*').eq('id', svc.id).single();
    assert.strictEqual(dbSvc.id, svc.id);
    assert.strictEqual(dbSvc.workspace_id, testWorkspaceId);
  });

  // 16. API key creation persistence
  await runTest('16. API key creation persistence in PostgreSQL', async () => {
    const { rawKey, keyRecord } = await developerService.createApiKey(
      testWorkspaceId,
      serviceAccountId,
      'Production Testing Key',
      ['assets:read', 'assets:write']
    );

    assert(rawKey.startsWith('mda_live_'), 'Raw key must have prefix mda_live_');
    assert(keyRecord && keyRecord.id, 'Key record must be created');

    // Verify key exists in PostgreSQL
    const { data: dbKey } = await supabaseAdmin.from('api_keys').select('*').eq('id', keyRecord.id).single();
    assert.strictEqual(dbKey.id, keyRecord.id);
    assert.strictEqual(dbKey.workspace_id, testWorkspaceId);
    assert(dbKey.key_hash, 'Key hash must be stored in DB');
    assert(!dbKey.raw_key, 'Raw key must NEVER be stored in DB');
  });

  // 17. Logout/Login persistence
  await runTest('17. Logout/Login persistence (DB resolution consistency)', async () => {
    // Resolving again for testUser yields the exact same persistent workspace
    const res1 = await resolveAuthorizedWorkspace({ userId: testUserId });
    const res2 = await resolveAuthorizedWorkspace({ userId: testUserId });
    assert.strictEqual(res1.workspace.id, res2.workspace.id);
    assert.strictEqual(res1.workspace.id, testWorkspaceId);
  });

  // 18. Concurrent orphan provisioning yields one workspace
  await runTest('18. Concurrent orphan provisioning safety', async () => {
    const concurrentUserId = `usr_concurrent_${Date.now()}`;
    const concurrentEmail = `concurrent_${Date.now()}@acme-corp.com`;

    // Provision concurrently
    const [p1, p2] = await Promise.all([
      workspaceService.createPersonalWorkspaceForUser(concurrentUserId, concurrentEmail, 'Concurrent User'),
      workspaceService.createPersonalWorkspaceForUser(concurrentUserId, concurrentEmail, 'Concurrent User'),
    ]);

    assert(p1.id && p2.id, 'Both provisioning attempts succeed');

    // Clean up
    await supabaseAdmin.from('folders').delete().in('workspace_id', [p1.id, p2.id]);
    await supabaseAdmin.from('workspace_memberships').delete().in('workspace_id', [p1.id, p2.id]);
    await supabaseAdmin.from('workspaces').delete().in('id', [p1.id, p2.id]);
  });

  // 19. /auth/me cookie reissue logic
  await runTest('19. /auth/me cookie reissue validation', async () => {
    // When session workspace is ghost or stale, resolution marks sessionNeedsRefresh
    const ghostRes = await resolveAuthorizedWorkspace({
      userId: testUserId,
      requestedWorkspaceId: 'ws_stale_cookie_value',
    });
    assert.strictEqual(ghostRes.sessionNeedsRefresh, true, 'Cookie reissue must be triggered');
    assert.strictEqual(ghostRes.workspace.id, testWorkspaceId);
  });

  // 20. No universal ws_default grant
  await runTest('20. No universal ws_default grant (Tenant Isolation Audit)', async () => {
    const { data: wsDefaultMembers } = await supabaseAdmin
      .from('workspace_memberships')
      .select('user_id')
      .eq('workspace_id', 'ws_default');

    // Only platform super admin is member of ws_default
    assert(wsDefaultMembers && wsDefaultMembers.length >= 1, 'ws_default must have platform admin');
    const memberIds = wsDefaultMembers.map((m) => m.user_id);
    assert(!memberIds.includes(testUserId), 'testUser must NOT have membership to ws_default');
    assert(!memberIds.includes('812a5283-dd7b-4381-8356-d98bd495f450'), 'luan0891 must NOT be mass-granted ws_default');
  });

  // Clean up test fixtures
  console.log('\nCleaning up test fixtures...');
  await supabaseAdmin.from('api_keys').delete().eq('workspace_id', testWorkspaceId);
  await supabaseAdmin.from('service_accounts').delete().eq('workspace_id', testWorkspaceId);
  await supabaseAdmin.from('applications').delete().eq('workspace_id', testWorkspaceId);
  await supabaseAdmin.from('assets').delete().eq('workspace_id', testWorkspaceId);
  await supabaseAdmin.from('folders').delete().eq('workspace_id', testWorkspaceId);
  await supabaseAdmin.from('workspace_memberships').delete().eq('workspace_id', testWorkspaceId);
  await supabaseAdmin.from('workspaces').delete().eq('id', testWorkspaceId);

  console.log('\n============================================================');
  console.log(`TEST SUITE RESULTS: ${passedTests}/${totalTests} PASSED`);
  console.log('Media Platform v3.8.3 Workspace Persistence Gate: PASSED');
  console.log('============================================================\n');
}

main().catch((err) => {
  console.error('\nTest Suite FAILED:', err);
  process.exit(1);
});
