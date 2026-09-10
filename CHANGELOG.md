# Changelog

All notable changes to the Media Platform codebase are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
