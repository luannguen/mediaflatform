# 🔁 API Idempotency Guide

To protect distributed systems against network timeouts, dropped connections, and accidental client retries, Media Platform supports the `Idempotency-Key` header on all mutating endpoints (`POST`, `PUT`, `PATCH`, `DELETE`).

---

## 1. How It Works

1. Client sends a request with an `Idempotency-Key` header (e.g., UUIDv4 or domain key like `order_123_banner_upload`).
2. The server computes a canonical JSON hash (SHA-256 with recursively sorted keys so key order does not alter the fingerprint).
3. The server atomically attempts to reserve an execution slot in PostgreSQL via `reserve_idempotency_key`, generating a unique `execution_token` and setting a `lease_expires_at` timestamp (default 60 seconds).
4. **Fail-Closed Semantics**: If the idempotency datastore or RPC cluster is unreachable, the request **fails closed immediately** with HTTP `503 Service Unavailable` (`IDEMPOTENCY_UNAVAILABLE`). The underlying mutation is never executed without idempotency guarantees.
5. **Execution Fencing & Zombie Rejection**:
   - The worker holding the valid `execution_token` must complete the request via `complete_idempotency_key` before the lease expires.
   - If a worker crashes or stalls, another worker can take over the reservation once the lease expires.
   - Any completion attempt by a zombie worker possessing a superseded token is rejected with `RESERVATION_LOST`.
   - Long-running jobs can periodically extend their lease via `renew_idempotency_lease`.
6. If a network blip occurs and the client retries the exact same request with the same `Idempotency-Key`:
   - Media Platform detects the cached result.
   - It returns the original HTTP response status and body immediately without repeating side-effects (e.g. no duplicate asset records or transcoding jobs).
7. If a client re-uses an `Idempotency-Key` with a **different payload or route**, the server protects against unintended data corruption by responding with:
   - HTTP `409 Conflict`
   - Code `IDEMPOTENCY_CONFLICT`

---

## 2. Header Usage

```http
POST /api/v1/uploads/direct HTTP/1.1
Host: media.yourdomain.com
X-Media-Api-Key: mda_live_xxxxxxxxxxxxxxxx
Idempotency-Key: idemp_9f83a812-421d-40c2-b364-927a4e0192e2
Content-Type: multipart/form-data; boundary=...
```

---

## 3. SDK Support

When using `@media-platform/sdk`, pass `idempotencyKey` directly in the request options:

```typescript
const asset = await media.assets.upload(buffer, {
  displayName: 'Contract Scan'
}, {
  idempotencyKey: 'idemp_contract_upload_2026_09'
});
```
