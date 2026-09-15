# Changelog

All notable changes to the Media Platform codebase are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [3.8.5] - 2026-09-14

### Fixed
- Verified Supabase identities, tenant scope checks and explicit test-only mocks; removed environment admin login and role simulation.
- Enabled RLS/revoked public database access and made Storage private; protected media is delivered through the gateway.
- Shared API request controls, CSRF checks, durable idempotency fencing and tenant-aware request logs.
- Persistent invitations and atomic acceptance; current member names/emails come from verified Auth identities.
- Unified upload sessions for dashboard, SDK, multipart compatibility routes and CMS connectors. Worker validates bytes/SHA-256 before lease-fenced publication.
- Real PDF first-page rendering, shared worker pipelines, and explicit FFmpeg failures without synthetic output.
- Atomic restore, reference-aware purge with recursive pagination and recoverable storage failures, and scheduled expired-session cleanup.
- Transactional webhook outbox, scoped deliveries, bounded retries and DNS-pinned public HTTPS transport.
- Full-window database analytics, SDK pagination and safe mutation retry behavior.
- Mobile dashboard navigation and accessible action labels.

### Build and operations
- Added checksum-ledger SQL migrations, database/HTTP/media regression suites, SDK CJS/ESM/declaration build, dependency audit and CI.
- Node 22.13+ required; Sharp/PDF.js/native canvas are explicit runtime dependencies. Patched nested PostCSS dependency.
- See [production runbook](docs/operations/PRODUCTION.md) for private-bucket URL migration, incomplete legacy uploads, credential replay restrictions and old-worker incompatibility.
- Detailed verification and deployment limits: [release evidence](docs/PRODUCTION-UPDATE.md).

## [3.8.3] - 2026-09-10

### Fixed & Hardened (Workspace Persistence & Production Identity Integrity)
- **Eliminated Ghost Workspace & FK Constraint Violations**:
  - Replaced in-memory `mockDb` workspace manipulation in `src/services/workspaceService.ts` with 100% database-backed PostgreSQL persistence via `supabaseAdmin`.
  - Added atomic PostgreSQL RPC `provision_workspace_for_user(...)` ensuring workspace, owner membership, and default root folder (`General Media`) are created in a single ACID transaction.
  - Added deterministic unique slug collision resolution using random hash suffixes.
- **Central Authorization Resolver & Strict Tenant Isolation**:
  - Implemented `resolveAuthorizedWorkspace()` as the single authority for workspace tenant resolution:
    - Queries active memberships in `workspace_memberships` table.
    - Authoritative role directly derived from PostgreSQL DB membership `role_id` (DB role wins over session cache).
    - Strictly rejects cross-tenant access attempts with `403 WORKSPACE_ACCESS_DENIED`.
    - Automatically heals ghost cookies to the user's real personal workspace.
    - Strictly forbids universal `ws_default` fallback or mass granting.
- **Auth Guard & Session Cookie Self-Healing**:
  - Upgraded `authenticateRequest()` in `auth-guard.ts` to validate real DB membership before returning user principal.
  - Upgraded `GET /api/v1/auth/me` to automatically re-issue fresh `mda_session` cookie containing verified workspace and DB role when stale/ghost cookies are detected.
  - Removed deceptive UI fallback `activeWs?.id || mockWorkspace.id`.
- **Production Silent Mock Fallback Removal**:
  - Implemented centralized policy in `src/lib/platform/persistence-mode.ts` (`isPersistentMode`, `isMockModeAllowed`, `assertPersistentBackend`).
  - Audited and eliminated silent mock fallbacks in `folderService.ts` and `developerService.ts`: DB errors throw explicit `AppError.internal` with standardized error codes.
  - Added cross-tenant parent folder validation to `folderService.createFolder`.
- **Upload Storage Compensation**:
  - Implemented atomic compensation in `POST /api/v1/uploads`: if asset record insertion or downstream processing fails after storage upload, the uploaded storage key is automatically deleted, preventing permanent storage leaks.
- **Safe Database Migration & Backfill**:
  - Executed `scripts/migrate-v3-8-3-workspace-persistence.js`:
    - Deployed `provision_workspace_for_user` stored procedure and unique index on `workspace_memberships(workspace_id, user_id)`.
    - Repaired legacy orphan user `812a5283-dd7b-4381-8356-d98bd495f450` (`luan0891`) with dedicated personal workspace `ws_user_812a5283`.
    - Preserved configured platform Super Admin membership on `ws_default`.
    - Repaired all orphan identities with zero cross-tenant bleeding.

---

## [3.8.2] - 2026-09-10

### Added
- **Idempotency Execution Fencing & Lease Semantics**:
  - Added atomic `execution_token` and configurable `lease_expires_at` (default 60s) to `idempotency_records`.
  - Implemented `renew_idempotency_lease` RPC to allow active long-running workers to extend leases safely.
  - Hardened `complete_idempotency_key` and `fail_idempotency_key` to atomically reject zombie/stale worker mutations with `RESERVATION_LOST`.
  - Canonical JSON request body fingerprinting: key-order independent hashing via deep recursive object key sorting.
- **Rate Limiter Failure Policy & Window Clarification**:
  - Implemented `RATE_LIMIT_FAILURE_POLICY`: Mutation, upload, expensive transform, and admin routes fail closed (`503 RATE_LIMIT_UNAVAILABLE`) when the rate limiter datastore is unreachable. Read routes fail open with `X-RateLimit-Enforcement: degraded` header.
  - Eliminated silent in-memory fallback in production environments unless explicitly allowed via `ALLOW_LOCAL_RATE_LIMIT_FALLBACK=true`.
  - Clarified architectural documentation to **Windowed Token Bucket / Fixed-Window Token Limiter**.
- **Deterministic Health Subsystem Aggregation & Configuration Validation**:
  - Implemented `validateRuntimeConfiguration`: Prohibits silent mock fallback in production if Supabase credentials or storage bucket configuration are missing.
  - Deterministic `aggregateHealthStatus`: Subsystem degradation (e.g. queue stalled with zero workers online, DLQ backlog, RPC integrity degradation) strictly bubbles up to overall status.
  - Non-mutating signature-aware RPC probe: Upgraded `verify_platform_rpcs()` to verify existence and argument counts (`pronargs`) across all 8 critical platform RPCs via `pg_proc`.
- **OpenAPI 3.1 Contract Validation**:
  - Added automated CI contract test (`npm run test:openapi`) using `@apidevtools/swagger-parser` validating structural schema correctness, all 27 unique `operationId`s, required component schemas, and public routes.
- **Multi-Tenant Webhook Usage Isolation Test**:
  - Added fixture-driven cross-tenant test proving strictly isolated webhook counts per workspace without leakage.
- **Security Definer & Role Hardening**:
  - Set `SET search_path = public` across all platform RPCs.
  - Revoked execute permissions from `PUBLIC` and `anon`; granted exclusively to `service_role` and `postgres`.

---

## [3.8.0] - 2026-09-10

### Added
- **Official TypeScript SDK (`@media-platform/sdk`)**: Universal client with zero dependencies, automatic exponential backoff with full jitter, `X-Request-Id` propagation, typed error handling via `MediaPlatformError`, and idempotency support.
- **OpenAPI 3.1 Specification**: Exposed at `/api/openapi.json` and `/api/v1/openapi.json`.
- **3-Tier Health Check Engine**:
  - `GET /api/v1/health/live`: In-memory process liveness probe (<5ms).
  - `GET /api/v1/health/ready`: Database & Object Storage readiness probe.
  - `GET /api/v1/health/deep`: Deep diagnostic probe with live storage write-read-delete verification, queue depth, and worker health.
- **Developer Control Plane & Observability**:
  - `GET /api/v1/capabilities`: Machine-readable platform capability discovery.
  - `GET /api/v1/developer/diagnostics`: Secure caller context, permissions, and quota diagnostics.
  - `GET /api/v1/developer/logs`: Filtered API traffic logs with deep credential redaction.
  - `POST /api/v1/developer/keys/:id/rotate`: Zero-downtime API key rotation with configurable grace periods.
- **Operational Fleet Visibility**:
  - `GET /api/v1/admin/workers`: Fleet management, worker status, and heartbeat staleness tracking.
  - Automatic worker registration and periodic heartbeats in `scripts/run-queue-worker.js`.
- **Dedicated Usage & Quota Service**:
  - `GET /api/v1/usage`: Ground-truth calculations for storage, bandwidth, and asset type breakdowns.
- **Webhook Safe Replay**:
  - `POST /api/v1/webhooks/deliveries/:id/replay`: Replay past webhook dispatches safely with immutable history retention.
- **Distributed Security Primitives**:
  - `Idempotency-Key` tracking with payload fingerprinting and `409 IDEMPOTENCY_CONFLICT` protection.
  - Sliding window rate limiting with standard headers (`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `Retry-After`).
  - Durable critical audit event recording (`auditService.recordCritical`).

### Changed
- **Removed Fake Analytics Telemetry**: Purged synthetic metrics (`med_demo_nike_sneaker`) from production. Empty workspaces return pure zero values.
- **Sanitized Request Tracking**: Centralized `X-Request-Id` generation and propagation in middleware and response handlers with deep parameter and header redaction.
- **Corrected Architectural Documentation**: Replaced all obsolete `storage_url` persistence instructions in integration guides with `asset_id` (`med_...`) and dynamic delivery resolution.

### Security
- Added automated secret masking for query parameters, JSON payloads, and headers (`token`, `secret`, `password`, `key`).
- Enhanced API key scope registry with explicit per-route permission enforcement.
