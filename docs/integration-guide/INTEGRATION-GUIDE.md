# 🔌 MEDIA PLATFORM INTEGRATION GUIDE FOR EXTERNAL APPLICATIONS

**Target Audience**: Backend & Full-stack Engineers of Main Platform, Commerce, Community, CMS, CRM  
**Core Rule**: Never store raw storage URLs in external databases. Store only `media_id` (`med_...`) and register references.

---

## 1. Environment Configuration

In your application's `.env.production` or `.env.local` (Server-side ONLY):

```env
# Media Platform Integration
MEDIA_PLATFORM_API_URL=https://your-media-domain.vercel.app/api/v1
MEDIA_PLATFORM_API_KEY=mda_live_xxxxxxxxxxxxxxxxxxxxxxxx
```

> [!CAUTION]
> Never expose `MEDIA_PLATFORM_API_KEY` to client-side browsers, mobile app bundles, or public repositories. All authenticated calls to Media Platform must pass through your application's server-side proxy or backend services.

---

## 2. Resolving Media Delivery URLs

When rendering a product, article, or profile, query the Media Platform to resolve the latest active CDN / delivery URL:

### Node.js / TypeScript Example
```typescript
import axios from 'axios';

const mediaClient = axios.create({
  baseURL: process.env.MEDIA_PLATFORM_API_URL,
  headers: {
    'X-Media-Api-Key': process.env.MEDIA_PLATFORM_API_KEY,
  },
});

export async function resolveMediaUrl(mediaId: string): Promise<string> {
  const response = await mediaClient.get(`/assets/${mediaId}`);
  return response.data.data.storage_url;
}
```

---

## 3. Registering & Syncing References (Safe Delete Protection)

Whenever you link an asset to a Product, Article, or User Avatar, notify Media Platform via the **Atomic Reference Sync** endpoint. This ensures the asset cannot be accidentally deleted by an admin while your product is live.

### Product Catalog Sync Example
```typescript
export async function syncProductMedia(productId: string, heroMediaId: string, galleryMediaIds: string[]) {
  const references = [
    { asset_id: heroMediaId, field_name: 'hero_image' },
    ...galleryMediaIds.map((id) => ({ asset_id: id, field_name: 'gallery' })),
  ];

  await mediaClient.post('/references/sync', {
    source_app: 'commerce',
    entity_type: 'product',
    entity_id: productId,
    references,
  });
}
```

---

## 4. Handling `ASSET_IN_USE` Error

If an administrator tries to permanently delete an asset that is currently referenced by your application, Media Platform responds with HTTP `409 Conflict`:

```json
{
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

## 5. Direct Upload from External Backend

```bash
curl -X POST https://your-media-domain.vercel.app/api/v1/uploads \
  -H "X-Media-Api-Key: mda_live_xxxxxxxxxxxxxxxx" \
  -F "file=@/path/to/local-image.jpg" \
  -F "display_name=Autumn Coat Hero" \
  -F "visibility=public"
```

Response:
```json
{
  "data": {
    "id": "med_01j8...",
    "display_name": "Autumn Coat Hero",
    "storage_url": "https://...",
    "mime_type": "image/jpeg",
    "size_bytes": 1048576,
    "status": "active"
  },
  "meta": {
    "checksum": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  }
}
```
