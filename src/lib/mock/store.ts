import {
  Asset,
  Folder,
  Collection,
  Tag,
  Application,
  ServiceAccount,
  ApiKey,
  AssetReference,
  Workspace,
  WorkspaceMembership,
  WorkspaceInvitation,
  WebhookEndpoint,
  WebhookDelivery,
  AssetVersion,
  AssetVariant,
  IntegrityIssue,
  UsageMetric,
  ProcessingJob,
} from '@/types/database';
import { generateId } from '../ids/generator';

// Default mock workspace & organization for local development
export const mockWorkspace: Workspace = {
  id: 'ws_default',
  organization_id: 'org_default',
  name: 'Production Media',
  slug: 'production',
  description: 'Primary Multi-App Asset Workspace',
  status: 'active',
  default_visibility: 'workspace',
  storage_policy: 'standard',
  retention_policy: {
    trash_retention_days: 30,
    unused_asset_retention_days: 90,
  },
  quota_storage_bytes: 10 * 1024 * 1024 * 1024, // 10 GB
  quota_asset_count: 50000,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

// In-memory collections for dev/mock mode
class MockDatabase {
  public workspaces: Workspace[] = [];
  public workspaceMemberships: WorkspaceMembership[] = [];
  public invitations: WorkspaceInvitation[] = [];
  public assets: Asset[] = [];
  public folders: Folder[] = [];
  public collections: Collection[] = [];
  public tags: Tag[] = [];
  public applications: Application[] = [];
  public serviceAccounts: ServiceAccount[] = [];
  public apiKeys: ApiKey[] = [];
  public references: AssetReference[] = [];
  public webhookEndpoints: WebhookEndpoint[] = [];
  public webhookDeliveries: WebhookDelivery[] = [];
  public assetVersions: AssetVersion[] = [];
  public assetVariants: AssetVariant[] = [];
  public integrityIssues: IntegrityIssue[] = [];
  public usageMetrics: UsageMetric[] = [];
  public processingJobs: ProcessingJob[] = [];

  constructor() {
    this.seed();
  }

  private seed() {
    const now = new Date().toISOString();

    // Seed sample workspaces
    this.workspaces.push(
      mockWorkspace,
      {
        id: 'ws_personal_admin',
        organization_id: 'org_personal_admin',
        name: "Executive Creative Hub",
        slug: 'executive-creative-hub',
        description: 'Personal photography and creative portfolios',
        status: 'active',
        default_visibility: 'private',
        storage_policy: 'standard',
        quota_storage_bytes: 5 * 1024 * 1024 * 1024,
        quota_asset_count: 10000,
        created_at: new Date(Date.now() - 86400000 * 10).toISOString(),
        updated_at: now,
      },
      {
        id: 'ws_alpha_studio',
        organization_id: 'org_alpha',
        name: 'Alpha Design Studio',
        slug: 'alpha-design-studio',
        description: 'Agency client collaborations and brand guidelines',
        status: 'active',
        default_visibility: 'workspace',
        storage_policy: 'standard',
        quota_storage_bytes: 20 * 1024 * 1024 * 1024,
        quota_asset_count: 100000,
        created_at: new Date(Date.now() - 86400000 * 20).toISOString(),
        updated_at: now,
      }
    );

    // Seed memberships for Super Admin and Demo Users
    this.workspaceMemberships.push(
      {
        id: generateId('mem'),
        workspace_id: mockWorkspace.id,
        user_id: 'usr_super_admin',
        user_email: 'admin@media-platform.local',
        user_name: 'Platform Administrator (Super Admin / Owner)',
        role_id: 'role_owner',
        role: 'owner',
        status: 'active',
        joined_at: now,
        created_at: now,
        updated_at: now,
      },
      {
        id: generateId('mem'),
        workspace_id: 'ws_personal_admin',
        user_id: 'usr_super_admin',
        user_email: 'admin@media-platform.local',
        user_name: 'Platform Administrator (Super Admin / Owner)',
        role_id: 'role_owner',
        role: 'owner',
        status: 'active',
        joined_at: now,
        created_at: now,
        updated_at: now,
      },
      {
        id: generateId('mem'),
        workspace_id: mockWorkspace.id,
        user_id: 'usr_demo_admin',
        user_email: 'admin@zeroresidues.com',
        user_name: 'Alex Rivera (Lead Architect)',
        role_id: 'role_admin',
        role: 'admin',
        status: 'active',
        joined_at: now,
        created_at: now,
        updated_at: now,
      }
    );

    // Seed pending invitation for testing
    this.invitations.push({
      id: 'inv_alpha_studio_admin',
      workspace_id: 'ws_alpha_studio',
      workspace_name: 'Alpha Design Studio',
      inviter_user_id: 'usr_elena_vance',
      inviter_name: 'Elena Vance (Art Director)',
      invitee_email: 'admin@media-platform.local',
      role: 'editor',
      status: 'pending',
      created_at: new Date(Date.now() - 3600000 * 4).toISOString(),
      expires_at: new Date(Date.now() + 86400000 * 7).toISOString(),
    });

    // Seed sample folders
    const rootFolderId = generateId('fld');
    this.folders.push(
      {
        id: rootFolderId,
        workspace_id: mockWorkspace.id,
        name: 'Product Photography',
        slug: 'product-photography',
        description: 'E-commerce high-resolution photos',
        created_at: new Date(Date.now() - 86400000 * 5).toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: generateId('fld'),
        workspace_id: mockWorkspace.id,
        name: 'Marketing Campaigns',
        slug: 'marketing-campaigns',
        description: 'Social and banner assets',
        created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
        updated_at: new Date().toISOString(),
      }
    );

    // Seed sample assets
    const sampleAssets: Partial<Asset>[] = [
      {
        id: 'med_01j8m4k9a1b2c3',
        workspace_id: mockWorkspace.id,
        folder_id: rootFolderId,
        asset_type: 'image',
        original_filename: 'espresso-machine-hero.webp',
        display_name: 'Espresso Machine Pro X',
        description: 'Banner photography for flagship coffee product',
        mime_type: 'image/webp',
        extension: 'webp',
        size_bytes: 487290,
        width: 1920,
        height: 1080,
        storage_provider: 'supabase',
        storage_bucket: 'media-assets',
        storage_key: 'uploads/espresso-machine-hero.webp',
        storage_url: 'https://images.unsplash.com/photo-1517668808822-9ebb02f2a0e6?w=1200&auto=format&fit=crop&q=80',
        checksum_algorithm: 'sha256',
        checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        visibility: 'workspace',
        status: 'active',
        processing_status: 'ready',
        created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'med_02k9l5m8b3c4d5',
        workspace_id: mockWorkspace.id,
        folder_id: rootFolderId,
        asset_type: 'image',
        original_filename: 'ceramic-coffee-cup.jpg',
        display_name: 'Ceramic Artisan Mug',
        description: 'Handcrafted ceramic mug in olive green',
        mime_type: 'image/jpeg',
        extension: 'jpg',
        size_bytes: 654210,
        width: 1600,
        height: 1200,
        storage_provider: 'supabase',
        storage_bucket: 'media-assets',
        storage_key: 'uploads/ceramic-coffee-cup.jpg',
        storage_url: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=1200&auto=format&fit=crop&q=80',
        checksum_algorithm: 'sha256',
        checksum: 'a8f5f167f44f4964e6c998dee827110c',
        visibility: 'public',
        status: 'active',
        processing_status: 'ready',
        created_at: new Date(Date.now() - 86400000 * 2).toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'med_03l1m6n7c5d6e7',
        workspace_id: mockWorkspace.id,
        folder_id: null,
        asset_type: 'document',
        original_filename: 'coffee-roasting-guide.pdf',
        display_name: 'Specialty Coffee Roasting Specification',
        description: 'Technical manual for baristas and partners',
        mime_type: 'application/pdf',
        extension: 'pdf',
        size_bytes: 2450890,
        storage_provider: 'supabase',
        storage_bucket: 'media-assets',
        storage_key: 'uploads/coffee-roasting-guide.pdf',
        storage_url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
        checksum_algorithm: 'sha256',
        checksum: 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
        visibility: 'workspace',
        status: 'active',
        processing_status: 'ready',
        created_at: new Date(Date.now() - 86400000 * 1).toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    this.assets.push(...(sampleAssets as Asset[]));

    // Seed sample references (Safe Delete testing)
    this.references.push(
      {
        id: generateId('ref'),
        workspace_id: mockWorkspace.id,
        asset_id: 'med_01j8m4k9a1b2c3',
        source_app: 'commerce',
        entity_type: 'product',
        entity_id: 'prod_espresso_99',
        field_name: 'hero_image',
        context: { product_name: 'Espresso Machine Pro X', sku: 'ESP-PRO-X' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: generateId('ref'),
        workspace_id: mockWorkspace.id,
        asset_id: 'med_01j8m4k9a1b2c3',
        source_app: 'community',
        entity_type: 'post',
        entity_id: 'post_coffee_guide_42',
        field_name: 'cover_banner',
        context: { post_title: 'How to dial in your morning shot' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    );

    // Seed sample Developer App & Service Account
    const appId = generateId('app');
    this.applications.push({
      id: appId,
      workspace_id: mockWorkspace.id,
      name: 'Main E-Commerce Platform',
      slug: 'main-ecommerce',
      description: 'Production Commerce Backend Integration',
      environment: 'production',
      status: 'active',
      allowed_origins: ['https://store.example.com'],
      allowed_callback_urls: [],
      default_scopes: ['assets:read', 'assets:write', 'uploads:create', 'references:write'],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const svcId = generateId('svc');
    this.serviceAccounts.push({
      id: svcId,
      workspace_id: mockWorkspace.id,
      application_id: appId,
      name: 'backend-worker',
      description: 'Automated catalog sync worker',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    this.apiKeys.push({
      id: 'key_demo_landing_test_2026',
      workspace_id: mockWorkspace.id,
      service_account_id: svcId,
      name: 'Landing Demo Live Key (Full Access)',
      key_prefix: 'mda_live_demo2026',
      key_hash: '6a8c1b210ff9214d701e9587c31b68f12a2dfc37f4549a5b87806412fc50e1bc',
      scopes: ['*'],
      status: 'active',
      created_at: new Date().toISOString(),
    });
  }
}

// Global singleton for in-memory mock dev database
declare global {
  var __mockDb: MockDatabase | undefined;
}

const testMode = process.env.NODE_ENV === 'test' && process.env.ALLOW_TEST_MOCKS === 'true';
const rawTestDb = testMode ? (globalThis.__mockDb || (globalThis.__mockDb = new MockDatabase())) : undefined;
export const mockDb: MockDatabase = new Proxy({} as MockDatabase, {
  get(_target, property) {
    if (!testMode || !rawTestDb) throw new Error('Mock persistence is only available in explicitly configured tests');
    return Reflect.get(rawTestDb, property);
  },
  set(_target, property, value) {
    if (!testMode || !rawTestDb) throw new Error('Mock persistence is only available in explicitly configured tests');
    return Reflect.set(rawTestDb, property, value);
  },
});
if (testMode) {

// Ensure newly added collections exist on hot-reloaded singleton
if (!mockDb.workspaces || mockDb.workspaces.length === 0) {
  mockDb.workspaces = [
    mockWorkspace,
    {
      id: 'ws_personal_admin',
      organization_id: 'org_personal_admin',
      name: "Executive Creative Hub",
      slug: 'executive-creative-hub',
      description: 'Personal photography and creative portfolios',
      status: 'active',
      default_visibility: 'private',
      storage_policy: 'standard',
      quota_storage_bytes: 5 * 1024 * 1024 * 1024,
      quota_asset_count: 10000,
      created_at: new Date(Date.now() - 86400000 * 10).toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'ws_alpha_studio',
      organization_id: 'org_alpha',
      name: 'Alpha Design Studio',
      slug: 'alpha-design-studio',
      description: 'Agency client collaborations and brand guidelines',
      status: 'active',
      default_visibility: 'workspace',
      storage_policy: 'standard',
      quota_storage_bytes: 20 * 1024 * 1024 * 1024,
      quota_asset_count: 100000,
      created_at: new Date(Date.now() - 86400000 * 20).toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];
}
if (!mockDb.workspaceMemberships || mockDb.workspaceMemberships.length === 0) {
  const now = new Date().toISOString();
  mockDb.workspaceMemberships = [
    {
      id: 'mem_super_admin_default',
      workspace_id: mockWorkspace.id,
      user_id: 'usr_super_admin',
      user_email: 'admin@media-platform.local',
      user_name: 'Platform Administrator (Super Admin / Owner)',
      role_id: 'role_owner',
      role: 'owner',
      status: 'active',
      joined_at: now,
      created_at: now,
      updated_at: now,
    },
    {
      id: 'mem_super_admin_personal',
      workspace_id: 'ws_personal_admin',
      user_id: 'usr_super_admin',
      user_email: 'admin@media-platform.local',
      user_name: 'Platform Administrator (Super Admin / Owner)',
      role_id: 'role_owner',
      role: 'owner',
      status: 'active',
      joined_at: now,
      created_at: now,
      updated_at: now,
    },
    {
      id: 'mem_demo_admin',
      workspace_id: mockWorkspace.id,
      user_id: 'usr_demo_admin',
      user_email: 'admin@zeroresidues.com',
      user_name: 'Alex Rivera (Lead Architect)',
      role_id: 'role_admin',
      role: 'admin',
      status: 'active',
      joined_at: now,
      created_at: now,
      updated_at: now,
    },
  ];
}
if (!mockDb.invitations || mockDb.invitations.length === 0) {
  mockDb.invitations = [
    {
      id: 'inv_alpha_studio_admin',
      workspace_id: 'ws_alpha_studio',
      workspace_name: 'Alpha Design Studio',
      inviter_user_id: 'usr_elena_vance',
      inviter_name: 'Elena Vance (Art Director)',
      invitee_email: 'admin@media-platform.local',
      role: 'editor',
      status: 'pending',
      created_at: new Date(Date.now() - 3600000 * 4).toISOString(),
      expires_at: new Date(Date.now() + 86400000 * 7).toISOString(),
    },
  ];
}

}
