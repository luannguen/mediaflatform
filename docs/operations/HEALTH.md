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
- **Latency**: `< 50ms`.
- **Intended Caller**: Kubernetes readiness probe, edge traffic routing.
- **Response**: `200 OK` when healthy, `503 Service Unavailable` if database or storage is unreachable.

### Tier 3: Deep Diagnostic Probe (`GET /api/v1/health/deep`)
- **Purpose**: Full-system integrity verification.
- **Checks Performed**:
  - PostgreSQL database latency.
  - Job claiming RPC sanity (`claim_next_processing_job`).
  - Active worker fleet instance count and heartbeat staleness.
  - Processing queue depth (pending jobs).
  - Storage write-read-delete probe in `_health/probe_{req_id}.txt`.
- **Security**: Protected endpoint requiring session admin or API key with `admin:manage` scope.
- **Response**:
  ```json
  {
    "status": "ok",
    "timestamp": "2026-09-10T12:00:00.000Z",
    "checks": {
      "database": { "status": "ok", "latency_ms": 12, "rpc_claim_job": "available" },
      "storage_probe": { "status": "ok", "latency_ms": 24, "target_bucket": "media-assets" },
      "queue": { "pending_jobs": 0, "status": "healthy" },
      "workers": { "active_workers": 2, "stale_workers": 0, "status": "healthy" }
    }
  }
  ```
