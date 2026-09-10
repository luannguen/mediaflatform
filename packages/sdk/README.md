# @media-platform/sdk

Official Universal TypeScript/JavaScript Client SDK for Media Platform Headless API & DAM.

## Installation

```bash
npm install @media-platform/sdk
# or
pnpm add @media-platform/sdk
# or
yarn add @media-platform/sdk
```

## Quick Start

```typescript
import { MediaPlatformClient } from '@media-platform/sdk';

// Initialize with your project API Key
const media = new MediaPlatformClient({
  apiKey: process.env.MEDIA_API_KEY!,
  baseUrl: 'https://media.yourdomain.com' // or http://localhost:3000
});

// 1. Upload an asset
const asset = await media.assets.upload(fileBuffer, {
  displayName: 'Summer Dress Banner',
  visibility: 'public',
  tags: ['ecommerce', 'summer-2026']
});

console.log('Asset ID:', asset.id); // e.g. "med_fa2149b1c"

// 2. Attach Reference to lock against accidental deletion
await media.assets.attachReference({
  assetId: asset.id,
  sourceApp: 'ecommerce-store',
  entityType: 'product',
  entityId: 'prod_42'
});

// 3. Generate dynamic delivery URL (WebP, width 800px)
const deliveryUrl = media.assets.getDeliveryUrl(asset.id, {
  width: 800,
  format: 'webp',
  quality: 85
});

console.log('Dynamic CDN URL:', deliveryUrl);
```

## Error Handling

All SDK API errors throw `MediaPlatformError` with HTTP status, machine error code, and context request ID:

```typescript
import { MediaPlatformClient, MediaPlatformError } from '@media-platform/sdk';

try {
  await media.assets.get('med_nonexistent');
} catch (err) {
  if (err instanceof MediaPlatformError) {
    console.error('Failed with code:', err.code);       // e.g. "NOT_FOUND"
    console.error('HTTP Status:', err.status);           // e.g. 404
    console.error('Tracing Request ID:', err.requestId); // e.g. "req_mtv_..."
  }
}
```

## Idempotent Mutations

Pass `idempotencyKey` in request options to guarantee zero duplicate actions on retries or network drops:

```typescript
await media.assets.upload(file, { displayName: 'Invoice 101' }, {
  idempotencyKey: 'idemp_invoice_101_upload'
});
```

## Features

- **Universal**: Zero external runtime dependencies. Works in Node.js 18+, browsers, React, Next.js, and Cloudflare Workers.
- **Resilient**: Automatic exponential backoff with full jitter for 429, 502, 503, 504 errors and network drops.
- **Traceable**: Centralized `X-Request-Id` propagation on all client calls.
- **Multi-Tenant Safe**: Scoped workspace isolation and reference locking.
