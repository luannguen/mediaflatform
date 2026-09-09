# 🗄️ DATA MODEL & ENTITY RELATIONSHIPS

**Service**: Independent Media Platform / DAM  
**Database**: Supabase PostgreSQL 16  
**Tenancy**: Multi-tenant with strict Organization -> Workspace isolation

---

## 1. Entity Relational Diagram (ERD)

```text
organizations (1) ──< workspaces (N)
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
   folders (N)       collections (N)      assets (N) ──< asset_variants (N)
                           │                 │
                           ▼                 ├──< asset_references (N)
                  collection_assets (N)      ├──< asset_favorites (N)
                                             └──< asset_tags (N) >── tags (N)
```

Parallel Developer & Access Subsystems:
```text
workspaces (1) ──< applications (N) ──< service_accounts (N) ──< api_keys (N)
workspaces (1) ──< webhook_endpoints (N) ──< webhook_deliveries (N)
workspaces (1) ──< audit_events (N)
workspaces (1) ──< api_request_logs (N)
```

---

## 2. Core Entities Dictionary

### `assets`
The primary digital asset record:
- `id` (TEXT, PK): Globally unique prefixed ID (`med_...`).
- `workspace_id` (TEXT, FK): Tenant isolation key.
- `folder_id` (TEXT, FK, Nullable): Hierarchy organization.
- `asset_type` (ENUM): `image`, `video`, `audio`, `document`, `archive`, `other`.
- `original_filename` (TEXT): Name as uploaded from client.
- `display_name` (TEXT): Editable title in DAM.
- `mime_type` (TEXT): MIME (e.g. `image/webp`).
- `size_bytes` (BIGINT): File size.
- `storage_provider` (TEXT): `supabase`, `r2`, `s3`.
- `storage_key` (TEXT): Path in storage bucket.
- `storage_url` (TEXT): Resolved public/CDN delivery URL.
- `checksum` (TEXT): SHA-256 hash for duplicate warning.
- `visibility` (ENUM): `private`, `workspace`, `public`.
- `status` (ENUM): `uploading`, `active`, `archived`, `trashed`, `deleted`.
- `deleted_at` (TIMESTAMPTZ, Nullable): Timestamp when moved to trash.
- `purge_after` (TIMESTAMPTZ, Nullable): Scheduled date for permanent disposal.

### `asset_references`
The critical consumer tracking entity for **Safe Delete Protection**:
- `id` (TEXT, PK): `ref_...`
- `asset_id` (TEXT, FK -> assets.id): Target asset.
- `source_app` (TEXT): External consumer (e.g. `commerce`, `community`, `cms`).
- `entity_type` (TEXT): Resource type (e.g. `product`, `post`, `user_profile`).
- `entity_id` (TEXT): Primary key in external app (e.g. `prod_123`, `post_456`).
- `field_name` (TEXT, Nullable): Context field (e.g. `thumbnail`, `gallery`).

### `api_keys`
Cryptographically secure tokens for service accounts:
- `id` (TEXT, PK): `key_...`
- `workspace_id` (TEXT, FK -> workspaces.id)
- `service_account_id` (TEXT, FK -> service_accounts.id)
- `key_prefix` (TEXT): `mda_live_[8chars]`
- `key_hash` (TEXT): Salted SHA-256 hash (never plaintext).
- `scopes` (TEXT[]): List of permitted actions.
- `status` (TEXT): `active`, `revoked`, `expired`.
- `last_used_at` (TIMESTAMPTZ, Nullable).
