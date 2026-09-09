-- ==============================================================================
-- MEDIA PLATFORM DATABASE SCHEMA (SUPABASE POSTGRESQL)
-- Version: 1.0.0
-- Standard: Modular Monolith, Multi-Tenant, Zero-Trust RBAC, Reference Tracking
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. ENUMS & TYPES
DO $$ BEGIN
    CREATE TYPE asset_type_enum AS ENUM ('image', 'video', 'audio', 'document', 'archive', 'other');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE visibility_enum AS ENUM ('private', 'workspace', 'public');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE asset_status_enum AS ENUM ('uploading', 'active', 'archived', 'trashed', 'deleted', 'failed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE processing_status_enum AS ENUM ('pending', 'processing', 'ready', 'partial', 'failed');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE app_env_enum AS ENUM ('development', 'staging', 'production');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ==============================================================================
-- 3. TENANCY & ACCESS CONTROL
-- ==============================================================================

-- Organizations
CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    logo_asset_id TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
    owner_user_id TEXT NOT NULL,
    settings JSONB DEFAULT '{}'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Workspaces
CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
    default_visibility visibility_enum NOT NULL DEFAULT 'workspace',
    storage_policy TEXT NOT NULL DEFAULT 'standard',
    retention_policy JSONB DEFAULT '{"trash_retention_days": 30, "unused_asset_retention_days": 90}'::jsonb,
    quota_storage_bytes BIGINT NOT NULL DEFAULT 10737418240, -- 10 GB
    quota_asset_count BIGINT NOT NULL DEFAULT 50000,
    settings JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, slug)
);

-- Roles
CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    description TEXT,
    permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Workspace Memberships
CREATE TABLE IF NOT EXISTS workspace_memberships (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'suspended', 'removed')),
    invited_by TEXT,
    joined_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, user_id)
);

-- ==============================================================================
-- 4. ORGANIZATION (FOLDERS, COLLECTIONS, TAGS)
-- ==============================================================================

-- Folders
CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY, -- fld_...
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    parent_folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    UNIQUE(workspace_id, parent_folder_id, name)
);

-- Collections
CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY, -- col_...
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    cover_asset_id TEXT,
    visibility visibility_enum NOT NULL DEFAULT 'workspace',
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tags
CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY, -- tag_...
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, normalized_name)
);

-- ==============================================================================
-- 5. ASSET DOMAIN (THE CORE)
-- ==============================================================================

-- Assets
CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY, -- med_...
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT,
    folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
    asset_type asset_type_enum NOT NULL DEFAULT 'other',
    original_filename TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    mime_type TEXT NOT NULL,
    extension TEXT NOT NULL,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    width INT,
    height INT,
    duration_ms INT,
    storage_provider TEXT NOT NULL DEFAULT 'supabase',
    storage_bucket TEXT NOT NULL DEFAULT 'media-assets',
    storage_key TEXT NOT NULL,
    storage_url TEXT,
    checksum_algorithm TEXT NOT NULL DEFAULT 'sha256',
    checksum TEXT,
    visibility visibility_enum NOT NULL DEFAULT 'workspace',
    status asset_status_enum NOT NULL DEFAULT 'active',
    processing_status processing_status_enum NOT NULL DEFAULT 'ready',
    created_by_user_id TEXT,
    created_by_service_account_id TEXT,
    metadata_json JSONB DEFAULT '{}'::jsonb,
    deleted_at TIMESTAMPTZ,
    purge_after TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Asset Variants
CREATE TABLE IF NOT EXISTS asset_variants (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    variant_name TEXT NOT NULL, -- original, thumbnail, small, medium, large
    storage_provider TEXT NOT NULL DEFAULT 'supabase',
    storage_key TEXT NOT NULL,
    storage_url TEXT,
    mime_type TEXT NOT NULL,
    format TEXT,
    width INT,
    height INT,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    quality INT DEFAULT 80,
    status TEXT NOT NULL DEFAULT 'ready',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(asset_id, variant_name)
);

-- Collection Assets
CREATE TABLE IF NOT EXISTS collection_assets (
    id TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    sort_order INT NOT NULL DEFAULT 0,
    added_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(collection_id, asset_id)
);

-- Asset Tags
CREATE TABLE IF NOT EXISTS asset_tags (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(asset_id, tag_id)
);

-- Asset Favorites (per user)
CREATE TABLE IF NOT EXISTS asset_favorites (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, asset_id)
);

-- Upload Sessions
CREATE TABLE IF NOT EXISTS upload_sessions (
    id TEXT PRIMARY KEY, -- upl_...
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    requested_by_type TEXT NOT NULL, -- user / service_account
    requested_by_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'uploading', 'uploaded', 'completed', 'expired', 'failed', 'cancelled')),
    storage_key TEXT NOT NULL,
    asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Processing Jobs (Asynchronous Background Pipeline & Resilient Distributed Queue)
CREATE TABLE IF NOT EXISTS processing_jobs (
    id TEXT PRIMARY KEY, -- job_...
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    job_type TEXT NOT NULL CHECK (job_type IN ('video_transcode', 'image_optimization', 'audio_transcode', 'document_extract')),
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'pending', 'processing', 'retrying', 'completed', 'failed', 'dead_letter', 'cancelled')),
    current_stage TEXT NOT NULL DEFAULT 'queued',
    progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    source_storage_key TEXT NOT NULL,
    source_storage_url TEXT,
    target_profiles JSONB DEFAULT '[]'::jsonb,
    priority INTEGER NOT NULL DEFAULT 5,
    attempt INTEGER NOT NULL DEFAULT 1,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    locked_by TEXT,
    locked_at TIMESTAMPTZ,
    lease_expires_at TIMESTAMPTZ,
    heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    job_run_id TEXT,
    output_version TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_code TEXT,
    error_taxonomy TEXT,
    error_message TEXT,
    error_details JSONB DEFAULT '{}'::jsonb,
    metadata_json JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- 6. DEVELOPER PLATFORM & API KEYS
-- ==============================================================================

-- Applications
CREATE TABLE IF NOT EXISTS applications (
    id TEXT PRIMARY KEY, -- app_...
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    environment app_env_enum NOT NULL DEFAULT 'production',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
    allowed_origins TEXT[] DEFAULT '{}',
    allowed_callback_urls TEXT[] DEFAULT '{}',
    default_scopes TEXT[] DEFAULT '{assets:read,assets:write,uploads:create}',
    rate_limit_policy JSONB DEFAULT '{"rpm": 600, "uploads_per_min": 60}'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, slug)
);

-- Service Accounts
CREATE TABLE IF NOT EXISTS service_accounts (
    id TEXT PRIMARY KEY, -- svc_...
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- API Keys (Cryptographically Secure SHA-256 Hashed)
CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY, -- key_...
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    service_account_id TEXT NOT NULL REFERENCES service_accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key_prefix TEXT NOT NULL, -- e.g. mda_live_9fa8
    key_hash TEXT NOT NULL,   -- SHA-256 hash
    scopes TEXT[] NOT NULL DEFAULT '{assets:read}',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    revoked_by TEXT
);

-- ==============================================================================
-- 7. ASSET REFERENCES (SAFE DELETE & USAGE TRACKING)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS asset_references (
    id TEXT PRIMARY KEY, -- ref_...
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
    application_id TEXT REFERENCES applications(id) ON DELETE SET NULL,
    source_app TEXT NOT NULL,       -- commerce, community, crm, cms
    entity_type TEXT NOT NULL,      -- product, post, banner, category
    entity_id TEXT NOT NULL,        -- external entity identifier e.g. prod_999
    field_name TEXT,                -- thumbnail, gallery, avatar
    context JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(workspace_id, asset_id, source_app, entity_type, entity_id, field_name)
);

-- ==============================================================================
-- 8. WEBHOOKS & PROCESSING & TELEMETRY
-- ==============================================================================

-- Webhook Endpoints
CREATE TABLE IF NOT EXISTS webhook_endpoints (
    id TEXT PRIMARY KEY, -- wh_...
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    application_id TEXT REFERENCES applications(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    events TEXT[] NOT NULL DEFAULT '{asset.created,asset.deleted,upload.completed}',
    secret_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Webhook Deliveries
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id TEXT PRIMARY KEY,
    webhook_endpoint_id TEXT NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    event_id TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
    http_status INT,
    attempt_count INT NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,
    next_attempt_at TIMESTAMPTZ,
    response_summary TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Processing Jobs
CREATE TABLE IF NOT EXISTS processing_jobs (
    id TEXT PRIMARY KEY, -- job_...
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    job_type TEXT NOT NULL, -- metadata_extract, thumbnail, checksum, ai_analyze
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    attempt_count INT NOT NULL DEFAULT 0,
    input JSONB DEFAULT '{}'::jsonb,
    output JSONB DEFAULT '{}'::jsonb,
    error_code TEXT,
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit Events
CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY, -- evt_...
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'service_account', 'system')),
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL, -- asset.create, asset.trash, apikey.create, etc.
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    changes_summary JSONB DEFAULT '{}'::jsonb,
    request_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- API Request Logs
CREATE TABLE IF NOT EXISTS api_request_logs (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL, -- req_...
    workspace_id TEXT NOT NULL,
    application_id TEXT,
    service_account_id TEXT,
    method TEXT NOT NULL,
    route TEXT NOT NULL,
    status_code INT NOT NULL,
    duration_ms INT NOT NULL,
    user_agent TEXT,
    error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- 9. PERFORMANCE INDEXES
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_assets_workspace_status ON assets(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_assets_folder ON assets(workspace_id, folder_id);
CREATE INDEX IF NOT EXISTS idx_assets_checksum ON assets(workspace_id, checksum);
CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(workspace_id, asset_type);
CREATE INDEX IF NOT EXISTS idx_assets_created_at ON assets(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_references_asset ON asset_references(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_references_lookup ON asset_references(workspace_id, source_app, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_lookup ON api_keys(key_prefix, status);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_logs_request ON api_request_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_workspace ON audit_events(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_workspace_status ON processing_jobs(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_asset ON processing_jobs(asset_id);
CREATE INDEX IF NOT EXISTS idx_jobs_queue ON processing_jobs(status, priority DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_jobs_claim_atomic ON processing_jobs(status, available_at, priority DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_jobs_lease_expiry ON processing_jobs(status, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_jobs_dead_letter ON processing_jobs(workspace_id, status);

-- ==============================================================================
-- 10. SEED DEFAULT DATA
-- ==============================================================================

-- Roles
INSERT INTO roles (id, key, label, description, permissions, is_system)
VALUES 
('role_owner', 'owner', 'Owner', 'Full system access and ownership transfer', '{"*": true}'::jsonb, true),
('role_admin', 'admin', 'Admin', 'Full administrative capabilities', '{"asset.*": true, "folder.*": true, "collection.*": true, "member.*": true, "apikey.*": true, "webhook.*": true, "workspace.read": true}'::jsonb, true),
('role_media_manager', 'media_manager', 'Media Manager', 'Manage media library, folders, collections and tags', '{"asset.*": true, "folder.*": true, "collection.*": true, "tag.*": true}'::jsonb, true),
('role_editor', 'editor', 'Editor', 'Upload, update and organize media assets', '{"asset.read": true, "asset.create": true, "asset.update": true, "asset.trash": true, "folder.read": true, "folder.create": true}'::jsonb, true),
('role_uploader', 'uploader', 'Uploader', 'Upload files only', '{"asset.read": true, "asset.create": true}'::jsonb, true),
('role_viewer', 'viewer', 'Viewer', 'Read-only access to media library', '{"asset.read": true, "folder.read": true, "collection.read": true}'::jsonb, true),
('role_developer', 'developer', 'Developer', 'Manage API keys, applications, and view API docs/logs', '{"asset.read": true, "apikey.*": true, "application.*": true, "webhook.*": true, "audit.read": true}'::jsonb, true)
ON CONFLICT (key) DO NOTHING;

-- Default Organization & Workspace
INSERT INTO organizations (id, name, slug, description, owner_user_id, status)
VALUES ('org_default', 'Zero Residues Group', 'zero-residues', 'Default Media Organization', 'user_master', 'active')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO workspaces (id, organization_id, name, slug, description, status)
VALUES ('ws_default', 'org_default', 'Production Media', 'production', 'Main Production Workspace for Multi-App Assets', 'active')
ON CONFLICT (organization_id, slug) DO NOTHING;

-- Create default storage bucket for Supabase Storage (if storage schema exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
        INSERT INTO storage.buckets (id, name, public)
        VALUES ('media-assets', 'media-assets', true)
        ON CONFLICT (id) DO NOTHING;
    END IF;
END $$;
