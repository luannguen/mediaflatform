import { assetService } from '../src/services/assetService';
import { referenceService } from '../src/services/referenceService';
import { developerService } from '../src/services/developerService';
import { generateApiKey, verifyApiKeyHash, hasScope } from '../src/lib/security/api-key';
import { ErrorCodes } from '../src/lib/errors/codes';
import { AppError } from '../src/lib/errors/app-error';

async function runTests() {
  console.log('🧪 RUNNING MEDIA PLATFORM VERIFICATION TEST SUITE...\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${name}`);
      failed++;
    }
  }

  // TEST 1: API Key Generation & Hashing
  console.log('👉 [TEST 1] API Key Generation & Constant-Time Hash Verification');
  const { rawKey, keyPrefix, keyHash } = generateApiKey(true);
  assert(rawKey.startsWith('mda_live_'), 'Raw key starts with mda_live_');
  assert(rawKey.startsWith(keyPrefix), 'Raw key matches prefix');
  assert(verifyApiKeyHash(rawKey, keyHash), 'Hash matches raw key');
  assert(!verifyApiKeyHash('mda_live_fake_key_123', keyHash), 'Tampered key fails verification');

  // TEST 2: Scopes Enforcement
  console.log('\n👉 [TEST 2] Granular Scopes & Wildcard Authorization');
  assert(hasScope(['assets:read', 'assets:write'], 'assets:read'), 'Exact scope matches');
  assert(!hasScope(['assets:read'], 'assets:delete'), 'Missing scope denied');
  assert(hasScope(['assets:*'], 'assets:delete'), 'Domain wildcard matches');
  assert(hasScope(['*'], 'anything:allowed'), 'Global wildcard matches');

  // TEST 3: Asset Creation
  console.log('\n👉 [TEST 3] Asset Creation & SHA-256 Checksum Ingestion');
  const testAsset = await assetService.createAsset({
    originalFilename: 'test-product-banner.webp',
    displayName: 'Test Product Banner',
    mimeType: 'image/webp',
    sizeBytes: 102400,
    storageKey: 'uploads/test-product-banner.webp',
    checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  });
  assert(testAsset.id.startsWith('med_'), 'Asset ID has med_ prefix');
  assert(testAsset.status === 'active', 'Asset status is active');

  // TEST 4: Reference Registration & Safe Delete Protection
  console.log('\n👉 [TEST 4] Asset Reference Registration & Safe Delete Protection');
  await referenceService.createReference({
    assetId: testAsset.id,
    sourceApp: 'commerce',
    entityType: 'product',
    entityId: 'prod_macbook_pro_16',
    fieldName: 'thumbnail',
  });

  let safeDeleteBlocked = false;
  try {
    // Attempt deletion without force
    await assetService.safeDeleteAsset(testAsset.id, testAsset.workspace_id, false);
  } catch (error: any) {
    if (error instanceof AppError && error.code === ErrorCodes.ASSET_IN_USE) {
      safeDeleteBlocked = true;
    }
  }
  assert(safeDeleteBlocked, 'Permanent deletion BLOCKED because asset has active external references (ASSET_IN_USE)');

  // TEST 5: Atomic Reference Sync
  console.log('\n👉 [TEST 5] Atomic Reference Sync API');
  const syncResult = await referenceService.syncReferences({
    sourceApp: 'commerce',
    entityType: 'product',
    entityId: 'prod_macbook_pro_16',
    references: [], // Clear references
  });
  assert(syncResult.count === 0, 'References successfully cleared via atomic sync');

  // Now safe delete should succeed
  const deleteResult = await assetService.safeDeleteAsset(testAsset.id, testAsset.workspace_id, false);
  assert(deleteResult.success === true, 'Safe deletion succeeds after all references are cleared');

  // TEST 6: Soft Delete (Trash) & Restore Lifecycle
  console.log('\n👉 [TEST 6] Soft Delete (Trash) & Restore Lifecycle');
  const asset2 = await assetService.createAsset({
    originalFilename: 'temporary-document.pdf',
    displayName: 'Temporary Document',
    mimeType: 'application/pdf',
    sizeBytes: 204800,
    storageKey: 'uploads/temporary-document.pdf',
  });

  const trashed = await assetService.trashAsset(asset2.id);
  assert(trashed.status === 'trashed', 'Asset transitioned to status: trashed');
  assert(trashed.purge_after !== null, 'Asset has purge_after retention date scheduled');

  const restored = await assetService.restoreAsset(asset2.id);
  assert(restored.status === 'active', 'Asset restored to status: active');
  assert(restored.deleted_at === null, 'deleted_at cleared upon restoration');

  console.log(`\n==================================================`);
  console.log(`🏁 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log(`==================================================\n`);

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
