# 🚀 Media Platform Quick Start Guide

Get started with Media Platform in under 5 minutes using the official TypeScript SDK or Headless REST API.

---

## 1. Get an API Key

1. Log into your Media Platform Dashboard.
2. Navigate to **Developers** -> **API Keys**.
3. Click **Generate API Key**, select an Application, and copy your key (starts with `mda_live_` or `mda_test_`).

---

## 2. Using the TypeScript SDK

### Installation

```bash
npm install @media-platform/sdk
```

### Initialization

```typescript
import { MediaPlatformClient } from '@media-platform/sdk';

const media = new MediaPlatformClient({
  apiKey: process.env.MEDIA_API_KEY!,
  baseUrl: 'https://media.yourdomain.com', // defaults to http://localhost:3000
});
```

### Uploading an Asset

```typescript
import fs from 'fs';

// Read file into Buffer (Node.js)
const buffer = fs.readFileSync('./hero-banner.jpg');

const asset = await media.assets.upload(buffer, {
  displayName: 'Summer Collection Banner',
  visibility: 'public',
  tags: ['marketing', 'summer-2026'],
});

console.log('Uploaded asset ID:', asset.id); // "med_..."
```

### Delivering Optimized Images

```typescript
// On-the-fly WebP conversion, 800px width, 80% quality
const cdnUrl = media.assets.getDeliveryUrl(asset.id, {
  width: 800,
  format: 'webp',
  quality: 80,
  fit: 'cover',
});

console.log('CDN URL:', cdnUrl);
```

### Safe Delete Protection (Reference Sync)

```typescript
// Prevent accidental deletion while active in your product catalog
await media.assets.attachReference({
  assetId: asset.id,
  sourceApp: 'ecommerce-service',
  entityType: 'product',
  entityId: 'prod_9921',
  fieldName: 'hero_image',
});
```

---

## 3. Using Direct REST API (cURL)

### List Assets

```bash
curl -X GET "https://media.yourdomain.com/api/v1/assets?limit=10" \
  -H "X-Media-Api-Key: mda_live_xxxxxxxxxxxxxxxx"
```

### Direct Upload

```bash
curl -X POST "https://media.yourdomain.com/api/v1/uploads/direct" \
  -H "X-Media-Api-Key: mda_live_xxxxxxxxxxxxxxxx" \
  -H "Idempotency-Key: idemp_upload_test_01" \
  -F "file=@banner.jpg" \
  -F "display_name=Banner" \
  -F "visibility=public"
```

---

## Next Steps

- [Authentication & Scopes](../api/AUTHENTICATION.md)
- [Idempotency Guide](../api/IDEMPOTENCY.md)
- [Error Catalog](../api/ERRORS.md)
- [Webhooks & Safe Replay](WEBHOOKS.md)
