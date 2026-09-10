# 🔔 Outbound Webhooks & Safe Replay

Media Platform supports real-time HTTP webhooks for lifecycle events: asset uploads, processing completions, status changes, and deletion attempts.

---

## 1. Supported Event Types

| Event Type | Trigger | Payload Summary |
| :--- | :--- | :--- |
| `asset.created` | Direct upload or presigned upload finalized | Asset ID, MIME type, size |
| `asset.ready` | Distributed transcoding / transformation completed | Renditions, HLS manifest, dimensions |
| `asset.failed` | Transcoding or quarantine check failed | Error code, failure reason |
| `asset.deleted` | Asset soft-deleted or permanently purged | Asset ID, workspace ID |

---

## 2. Cryptographic Signature Verification (HMAC SHA-256)

Every webhook delivery includes an `X-Media-Signature` header:

```text
X-Media-Signature: sha256=d50e82c...
X-Media-Event: asset.ready
X-Media-Delivery: whd_01j8...
```

Verify the signature in Node.js / Express:

```typescript
import crypto from 'crypto';

export function verifyWebhook(rawBody: string, signatureHeader: string, signingSecret: string): boolean {
  const hash = crypto.createHmac('sha256', signingSecret).update(rawBody).digest('hex');
  const expected = `sha256=${hash}`;
  return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
}
```

---

## 3. Safe Webhook Replay

If your receiving server was down, you can replay any historical delivery safely without triggering duplicate processing. Media Platform preserves delivery history immutably.

### Via SDK:

```typescript
await media.webhooks.replayDelivery('whd_01j8m4k9a1b2c3');
```

### Via REST:

```bash
curl -X POST "https://media.yourdomain.com/api/v1/webhooks/deliveries/whd_01j8m4k9a1b2c3/replay" \
  -H "X-Media-Api-Key: mda_live_..."
```

Response:
```json
{
  "success": true,
  "data": {
    "replayed_delivery_id": "whd_01j8m4k9a1b2c3",
    "status": "delivered",
    "http_status": 200,
    "duration_ms": 142
  }
}
```
