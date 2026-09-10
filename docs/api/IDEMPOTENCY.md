# 🔁 API Idempotency Guide

To protect distributed systems against network timeouts, dropped connections, and accidental client retries, Media Platform supports the `Idempotency-Key` header on all mutating endpoints (`POST`, `PUT`, `PATCH`, `DELETE`).

---

## 1. How It Works

1. Client sends a request with an `Idempotency-Key` header (e.g., UUIDv4 or domain key like `order_123_banner_upload`).
2. The server hashes the request payload (SHA-256) and stores the key, hash, status, and response.
3. If a network blip occurs and the client retries the exact same request with the same `Idempotency-Key`:
   - Media Platform detects the cached result.
   - It returns the original HTTP response status and body immediately without repeating side-effects (e.g. no duplicate asset records or transcoding jobs).
4. If a client re-uses an `Idempotency-Key` with a **different payload**, the server protects against unintended data corruption by responding with:
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
