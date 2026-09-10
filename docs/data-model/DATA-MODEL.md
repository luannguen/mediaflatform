# 🗄️ DATA MODEL & ENTITY RELATIONSHIPS

**Service**: Independent Media Platform / DAM  
**Database**: Supabase PostgreSQL 16  
**Platform Version**: v3.8  
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

Parallel Operational, Developer & Control Plane Subsystems:
```text
workspaces (1) ──< applications (N) ──< service_accounts (N) ──< api_keys (N)
workspaces (1) ──< webhook_endpoints (N) ──< webhook_deliveries (N)
workspaces (1) ──< audit_events (N)
workspaces (1) ──< api_request_logs (N)
workspaces (1) ──< idempotency_records (N)
system (1)     ──< worker_instances (N)
system (1)     ──< rate_limit_buckets (N)
system (1)     ──< operational_alerts (N)
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
- `storage_url` (TEXT): Resolved public/CDN delivery URL. *(External systems store `id`, never raw bucket URLs).*
- `checksum` (TEXT): SHA-256 hash for duplicate warning.
- `visibility` (ENUM): `private`, `workspace`, `public`.
- `status` (ENUM): `uploading`, `active`, `archived`, `quarantined`, `trashed`, `deleted`.
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
- `key_prefix` (TEXT): `mda_live_[8chars]` or `mda_test_[8chars]`
- `key_hash` (TEXT): Salted SHA-256 hash (never plaintext).
- `scopes` (TEXT[]): List of permitted actions from `scopeRegistry`.
- `status` (TEXT): `active`, `revoked`, `expired`.
- `replaces_key_id` (TEXT, Nullable): For zero-downtime key rotation chaining.
- `rotated_at` (TIMESTAMPTZ, Nullable): When rotation was requested.
- `environment` (TEXT): `production` or `staging`.
- `last_used_at` (TIMESTAMPTZ, Nullable).

### `worker_instances`
Real-time worker fleet tracking & operational observability:
- `id` (TEXT, PK): Worker unique identifier (`worker_...` or host-pid combo).
- `hostname` (TEXT): Hostname / container ID.
- `pid` (INTEGER): Worker process ID.
- `status` (TEXT): `starting`, `online`, `busy`, `stopped`, `crashed`.
- `job_types` (TEXT[]): Capabilities handled by worker (e.g. `['transcode', 'hls', 'archive']`).
- `current_job_id` (TEXT, Nullable): Active leased processing job ID.
- `completed_jobs_count` (INTEGER): Cumulative completed jobs.
- `failed_jobs_count` (INTEGER): Cumulative failed jobs.
- `last_heartbeat_at` (TIMESTAMPTZ): High-resolution heartbeat timestamp.
- `started_at` (TIMESTAMPTZ): Process startup time.

### `idempotency_records`
Atomic idempotency cache preventing duplicate mutation execution:
- `id` (TEXT, PK): `idemp_...`
- `workspace_id` (TEXT, FK -> workspaces.id)
- `idempotency_key` (TEXT): Caller supplied unique token.
- `route` (TEXT): Request route pathname.
- `request_hash` (TEXT): SHA-256 fingerprint of the request payload.
- `response_status` (INTEGER): Cached HTTP status code (e.g. 200, 201).
- `response_headers` (JSONB): Replayable HTTP response headers.
- `response_body` (JSONB): Replayable serialized response data.
- `expires_at` (TIMESTAMPTZ): TTL expiry (default 24 hours).

### `rate_limit_buckets`
Sliding window rate limit token buckets:
- `key` (TEXT, PK): Compound bucket key (e.g. `rl:key_01j8...:write`).
- `tokens_remaining` (INTEGER): Remaining tokens in current window.
- `last_refill_at` (TIMESTAMPTZ): Refill evaluation timestamp.
- `expires_at` (TIMESTAMPTZ): Window expiration timestamp.

### `api_request_logs`
Redacted, centralized audit log of external API traffic:
- `id` (TEXT, PK): `log_...`
- `workspace_id` (TEXT, FK -> workspaces.id)
- `api_key_id` (TEXT, Nullable, FK -> api_keys.id)
- `request_id` (TEXT): Tracing UUID / timestamp identifier.
- `route` (TEXT): Pathname accessed.
- `method` (TEXT): `GET`, `POST`, `PUT`, `DELETE`, etc.
- `status_code` (INTEGER): HTTP status returned.
- `duration_ms` (INTEGER): Round-trip server execution time.
- `response_bytes` (INTEGER, Nullable): Size of the response payload.
- `ip_address` (TEXT, Nullable): Anonymized / client IP.
- `user_agent` (TEXT, Nullable): Calling client identifier.
