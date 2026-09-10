# 🔑 Zero-Downtime API Key Rotation

Security best practices mandate periodic credential rotation. Media Platform supports seamless API Key rotation with configurable overlap grace periods, preventing any downtime in production workloads.

---

## 1. How Rotation Works

When you rotate an existing API key:

1. A brand new API key (`mda_live_...`) is generated with identical workspace ID, service account, permissions, and scopes.
2. The old API key is marked as rotated (`rotated_at: now`), but remains **active and valid** for the duration of the `grace_period_hours` (default: 24 hours).
3. Your deployment pipeline or engineering team replaces the environment secret with the new key.
4. After the grace period elapses, the old key expires automatically without manual intervention.

---

## 2. Triggering Rotation

### Via Dashboard UI:
1. Go to **Developers** -> **API Keys**.
2. Locate the key to rotate and click **Rotate Key**.
3. Choose your grace period (e.g. 24 hours, 48 hours).
4. Save the new key securely.

### Via REST API:
```bash
curl -X POST "https://media.yourdomain.com/api/v1/developer/keys/key_01j8m4k9a1b2c3/rotate" \
  -H "X-Media-Api-Key: mda_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production Commerce Backend (Rotated 2026-09)",
    "grace_period_hours": 24
  }'
```

Response:
```json
{
  "success": true,
  "data": {
    "new_key": {
      "id": "key_01j9x...",
      "name": "Production Commerce Backend (Rotated 2026-09)",
      "token": "mda_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "key_prefix": "mda_live_1234",
      "expires_at": null
    },
    "rotated_old_key": {
      "id": "key_01j8m4k9a1b2c3",
      "expires_at": "2026-09-11T12:00:00.000Z",
      "status": "rotating"
    }
  }
}
```
