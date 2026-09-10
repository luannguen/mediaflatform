# ⚙️ Worker Fleet Architecture & Operations

Media Platform utilizes a distributed background worker fleet for heavy media transcoding, FFmpeg HLS segmentation, ZIP archive packaging, and PDF rasterization.

---

## 1. Worker Lifecycle & Heartbeat Protocol

Each worker process (e.g. running `scripts/run-queue-worker.js`):
1. **Registration**: On startup, calls `workerFleetService.registerWorker({ worker_id, hostname, pid, job_types })` into `worker_instances`.
2. **Heartbeat Loop**: Emits periodic heartbeats every 15 seconds updating `last_heartbeat_at`.
3. **Lease Extension**: While processing long-running transcoding jobs, automatically extends the PostgreSQL job lease (`lease_expires_at`).
4. **Graceful Shutdown**: Catches `SIGTERM` / `SIGINT`, updates status to `stopped`, and releases unprocessed locks.

---

## 2. Crash Recovery & Stale Worker Reaping

- If a worker crashes or loses network connectivity, its heartbeat ceases.
- Any worker instance with no heartbeat for `> 90 seconds` is flagged as `stale`.
- Any processing job leased by a stale worker whose lease expires is automatically reclaimed by active workers using the transactional `claim_next_processing_job` database RPC.

---

## 3. Fleet Administration API (`GET /api/v1/admin/workers`)

Inspect live fleet status:

```bash
curl -X GET "https://media.yourdomain.com/api/v1/admin/workers" \
  -H "X-Media-Api-Key: mda_live_..."
```

Response:
```json
{
  "success": true,
  "data": {
    "total_workers": 2,
    "active_workers": 2,
    "stale_workers": 0,
    "workers": [
      {
        "worker_id": "worker_node_prod_1",
        "hostname": "i-0912f84b9c",
        "status": "online",
        "current_job_id": null,
        "completed_jobs_count": 482,
        "failed_jobs_count": 1,
        "last_heartbeat_at": "2026-09-10T12:35:10.000Z"
      }
    ]
  }
}
```
