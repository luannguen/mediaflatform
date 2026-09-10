# 🔒 Private Assets & Secure Delivery

Media Platform provides fine-grained access control for sensitive assets (contracts, invoices, confidential videos, internal documentation).

---

## 1. Asset Visibility Tiers

Every asset has one of three visibility levels:

| Visibility | Direct CDN Access | API Key Access | Session Auth Required |
| :--- | :--- | :--- | :--- |
| `public` | ✅ Unauthenticated | ✅ Allowed | ❌ Not needed |
| `workspace` | ❌ Blocked | ✅ Same Workspace | ✅ Member of Workspace |
| `private` | ❌ Blocked | ✅ Allowed with explicit token | ✅ Asset Owner / Admin |

---

## 2. Setting Private Visibility

When uploading via SDK:

```typescript
const asset = await media.assets.upload(buffer, {
  displayName: 'Vendor-Contract-2026.pdf',
  visibility: 'private',
});
```

Or via direct REST API:

```bash
curl -X POST "https://media.yourdomain.com/api/v1/uploads/direct" \
  -H "X-Media-Api-Key: mda_live_..." \
  -F "file=@contract.pdf" \
  -F "visibility=private"
```

---

## 3. Secure Delivery for Private Assets

Direct requests to `/api/v1/delivery/:id` for private assets will return `403 Forbidden` if unauthenticated.

To deliver private assets:

1. **Server-Side Proxy**: Backend applications with API keys fetch the asset stream or buffer and stream to authenticated end-users.
2. **Signed Delivery URLs**: Request short-lived signed tokens from the backend:
   ```typescript
   // In your backend application
   const signedUrl = await getSignedDeliveryUrl(asset.id, { expiresInSeconds: 300 });
   ```
3. **Quarantine Protection**: If an asset is quarantined by security scanning (`status: quarantined`), access is strictly denied across all delivery routes until reviewed by an admin.
