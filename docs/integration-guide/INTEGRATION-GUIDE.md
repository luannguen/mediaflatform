# 🔌 MEDIA PLATFORM INTEGRATION GUIDE FOR EXTERNAL APPLICATIONS

**Target Audience**: Backend & Full-stack Engineers of Main Platform, Commerce, Community, CMS, CRM  
**Core Rule**: **Never store raw bucket or storage URLs in external databases.** Store only `asset_id` (`med_...`) and register atomic references.

---

## 1. Environment Configuration

In your application's `.env.production` or `.env.local` (Server-side ONLY):

```env
# Media Platform Integration
MEDIA_PLATFORM_API_URL=https://your-media-domain.vercel.app
MEDIA_PLATFORM_API_KEY=mda_live_xxxxxxxxxxxxxxxxxxxxxxxx
```

> [!CAUTION]
> Never expose `MEDIA_PLATFORM_API_KEY` to client-side browsers, mobile app bundles, or public repositories. All authenticated calls to Media Platform must pass through your application's server-side proxy or backend services.

---

## 2. Using the Official TypeScript SDK (`@media-platform/sdk`)

The easiest and safest way to integrate is via `@media-platform/sdk`:

```bash
npm install @media-platform/sdk
```

```typescript
import { MediaPlatformClient } from '@media-platform/sdk';

export const media = new MediaPlatformClient({
  apiKey: process.env.MEDIA_PLATFORM_API_KEY!,
  baseUrl: process.env.MEDIA_PLATFORM_API_URL!,
});

// 1. Resolve Delivery URL (Dynamic on-the-fly transformation)
export function getProductImageUrl(assetId: string): string {
  return media.assets.getDeliveryUrl(assetId, {
    width: 800,
    format: 'webp',
    quality: 85,
    fit: 'cover',
  });
}
```

---

## 3. Resolving Media Delivery URLs (Without SDK / REST)

When rendering a product, article, or profile, deliver media through the unified Delivery Gateway:

```text
GET https://your-media-domain.vercel.app/api/v1/delivery/:asset_id?w=800&format=webp&q=85
```

For private assets requiring authentication, retrieve a time-limited signed delivery URL:

```typescript
// Fetch asset metadata and delivery parameters via API
export async function resolveMediaUrl(assetId: string): Promise<string> {
  // Returns unified dynamic CDN delivery endpoint
  return `${process.env.MEDIA_PLATFORM_API_URL}/api/v1/delivery/${assetId}?format=webp&w=800`;
}
```

> [!IMPORTANT]
> Storing raw bucket URLs (`https://supabase.co/storage/v1/object/public/...`) in your database bypasses CDN caching, on-the-fly image transformations, quarantine checks, and version rollbacks. Always store `asset_id` (`med_...`).

---

## 4. Registering & Syncing References (Safe Delete Protection)

Whenever you link an asset to a Product, Article, or User Avatar, notify Media Platform via the **Atomic Reference Sync** endpoint. This ensures the asset cannot be accidentally deleted by an admin while your product is live.

### Product Catalog Sync Example
```typescript
export async function syncProductMedia(productId: string, heroAssetId: string, galleryAssetIds: string[]) {
  const references = [
    { asset_id: heroAssetId, field_name: 'hero_image' },
    ...galleryAssetIds.map((id) => ({ asset_id: id, field_name: 'gallery' })),
  ];

  await media.assets.attachReference({
    assetId: heroAssetId,
    sourceApp: 'commerce',
    entityType: 'product',
    entityId: productId,
    fieldName: 'hero_image',
  });
}
```

---

## 5. Handling `ASSET_IN_USE` Error

If an administrator tries to permanently delete an asset that is currently referenced by your application, Media Platform responds with HTTP `409 Conflict`:

```json
{
  "success": false,
  "error": {
    "code": "ASSET_IN_USE",
    "message": "Cannot delete asset med_01j8m4k9a1b2c3 because it is referenced in 2 external locations.",
    "request_id": "req_1a2b3c",
    "details": {
      "references": [
        {
          "source_app": "commerce",
          "entity_type": "product",
          "entity_id": "prod_espresso_99",
          "field_name": "hero_image"
        }
      ]
    }
  }
}
```

---

## 6. Direct Upload from External Backend

```bash
curl -X POST https://your-media-domain.vercel.app/api/v1/uploads/direct \
  -H "X-Media-Api-Key: mda_live_xxxxxxxxxxxxxxxx" \
  -H "Idempotency-Key: idemp_product_upload_42" \
  -F "file=@/path/to/local-image.jpg" \
  -F "display_name=Autumn Coat Hero" \
  -F "visibility=public"
```

Response:
```json
{
  "success": true,
  "data": {
    "id": "med_01j8...",
    "display_name": "Autumn Coat Hero",
    "mime_type": "image/jpeg",
    "size_bytes": 1048576,
    "status": "active"
  },
  "meta": {
    "request_id": "req_mtv_abc123"
  }
}
```

Save `data.id` (`med_01j8...`) directly in your application database table `products.media_asset_id`.
