# 🩺 Operational Health Checks & Readiness Probes

Media Platform exposes a 3-tier health check architecture aligned with Kubernetes, edge load balancers, and enterprise uptime monitors.

---

## 1. Health Tiers

### Tier 1: Liveness Probe (`GET /api/v1/health/live`)
- **Purpose**: Fast process sanity check (is the Node.js event loop spinning and responsive?).
- **Dependencies**: **Zero**. Does NOT query PostgreSQL, Redis, or Object Storage.
- **Latency**: `< 5ms`.
- **Intended Caller**: Kubernetes liveness probe, AWS ALB target health check, Docker healthcheck.
- **Response**: `200 OK` `{ "status": "ok", "service": "media-platform-api" }`.

### Tier 2: Readiness Probe (`GET /api/v1/health/ready` or `/api/v1/health`)
- **Purpose**: Verify critical dependencies required to serve requests.
- **Dependencies**: PostgreSQL connectivity test, Storage bucket accessibility.
- **Mandatory Production Validation**: In `NODE_ENV=production`, `validateRuntimeConfiguration()` ensures that Supabase URL, Service Role Key, and Storage Bucket environment variables are set; otherwise returns `503 Service Unavailable` (`status: "not_ready"`). Mock mode is forbidden in production.
- **Latency**: `< 50ms`.
- **Intended Caller**: Kubernetes readiness probe, edge traffic routing.
- **Response**: `200 OK` when healthy, `503 Service Unavailable` if database or storage is unreachable.

### Tier 3: Deep Diagnostic Probe (`GET /api/v1/health/deep`)
- **Purpose**: Full-system integrity verification and deterministic status aggregation.
- **Checks Performed**:
  - PostgreSQL database connectivity and non-mutating signature inspection via `verify_platform_rpcs()` across all 8 critical platform RPCs (`pg_proc.pronargs`).
  - Active worker fleet instance count and heartbeat staleness.
  - Processing queue depth and queue/worker correlation (if queue > 0 but workers == 0, status transitions to `degraded`).
  - Storage write-read-delete real I/O probe in `_health/probe_{req_id}.txt`.
- **Deterministic Aggregation**: Overall status is strictly derived from child statuses via `aggregateHealthStatus()`. If any critical subsystem is degraded, overall status bubbles up to `degraded`.
- **Security**: Protected endpoint requiring session admin or API key with `admin:manage` scope.
- **Response**:
  ```json
  {
    "status": "ok",
    "timestamp": "2026-09-10T12:00:00.000Z",
    "checks": {
      "configuration": { "status": "ok", "environment": "production" },
      "database": { "status": "ok", "latency_ms": 12, "rpc_integrity": "verified" },
      "storage": { "status": "ok", "probe": "write_read_delete_verified", "latency_ms": 24 },
      "queue": { "status": "ok", "queued": 0, "dead_letter": 0 },
      "workers": { "status": "ok", "online_workers": 2, "stale_workers": 0 }
    }
  }
  ```
