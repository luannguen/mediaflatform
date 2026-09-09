export interface ApiEndpointSpec {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  category: 'Assets' | 'Uploads' | 'Delivery' | 'References' | 'Webhooks' | 'Developer' | 'Analytics' | 'Versioning';
  title: string;
  description: string;
  scopeRequired: string;
  parameters?: {
    name: string;
    in: 'query' | 'header' | 'path';
    type: string;
    required: boolean;
    description: string;
    example?: string;
  }[];
  requestBody?: {
    contentType: string;
    schema: string;
    example: string;
  };
  responses: {
    status: number;
    description: string;
    example: string;
  }[];
  curlExample: string;
  sdkExample: string;
}

export const API_SPECIFICATION: ApiEndpointSpec[] = [
  {
    id: 'list-assets',
    method: 'GET',
    path: '/api/v1/assets',
    category: 'Assets',
    title: 'List Assets (with Pagination & Sparse Fieldsets)',
    description: 'Retrieve media assets with optional filtering by type, folder, status, offset pagination or high-performance cursor pagination.',
    scopeRequired: 'assets:read',
    parameters: [
      { name: 'page', in: 'query', type: 'integer', required: false, description: 'Page number for offset pagination (default: 1)', example: '1' },
      { name: 'limit', in: 'query', type: 'integer | "all"', required: false, description: 'Number of items to return or "all" for unlimited safe fetch (max: 1000)', example: '24' },
      { name: 'cursor', in: 'query', type: 'string', required: false, description: 'Asset ID cursor for O(1) infinite scroll pagination', example: 'med_01j7abc' },
      { name: 'fields', in: 'query', type: 'string', required: false, description: 'Comma-separated field projection (Sparse Fieldsets)', example: 'id,display_name,storage_url' },
      { name: 'type', in: 'query', type: 'string', required: false, description: 'Filter by asset type: image, video, audio, document', example: 'image' },
      { name: 'folder_id', in: 'query', type: 'string', required: false, description: 'Filter by folder ID (or null for root)', example: 'fld_banners' },
      { name: 'search', in: 'query', type: 'string', required: false, description: 'Search term for file names and display titles', example: 'summer' }
    ],
    responses: [
      {
        status: 200,
        description: 'Assets successfully retrieved with pagination metadata & response headers (X-Total-Count, X-Next-Cursor)',
        example: JSON.stringify({
          success: true,
          data: [
            {
              id: 'med_01j7m8x',
              display_name: 'Summer Campaign Hero',
              storage_url: 'https://cdn.platform.com/media-assets/summer.webp',
              mime_type: 'image/webp',
              size_bytes: 245120
            }
          ],
          meta: {
            pagination: {
              total: 142,
              page: 1,
              limit: 24,
              has_more: true,
              next_cursor: 'med_01j7m8x'
            }
          }
        }, null, 2)
      }
    ],
    curlExample: `curl -X GET "https://api.media-platform.com/api/v1/assets?limit=24&type=image" \\
  -H "X-Media-Api-Key: mda_live_xxxxxxxxxxxxxxxx" \\
  -H "X-Media-Api-Version: 2026-09-01"`,
    sdkExample: `// 1. Standard Page-based
const res = await media.listAssets({ page: 1, limit: 20, type: 'image' });

// 2. High-performance Cursor-based
const cursorRes = await media.listAssets({ cursor: 'med_01j7...', limit: 50 });

// 3. Unlimited Auto-Pagination Iterator
for await (const asset of media.iterateAssets({ type: 'image' })) {
  console.log(asset.id, asset.display_name);
}`
  },
  {
    id: 'batch-assets',
    method: 'POST',
    path: '/api/v1/assets/batch',
    category: 'Assets',
    title: 'Batch Resolve Assets (Anti N+1 Queries)',
    description: 'Bulk query up to 100 media IDs in a single HTTP request with optional format transformations. Completely eliminates N+1 network latency.',
    scopeRequired: 'assets:read',
    requestBody: {
      contentType: 'application/json',
      schema: '{ asset_ids: string[]; fields?: string[]; transform?: { width?: number; format?: string; quality?: number } }',
      example: JSON.stringify({
        asset_ids: ['med_01j7a', 'med_01j7b', 'med_01j7c'],
        fields: ['id', 'display_name', 'storage_url'],
        transform: { width: 600, format: 'webp', quality: 80 }
      }, null, 2)
    },
    responses: [
      {
        status: 200,
        description: 'Array of resolved assets enriched with computed delivery URLs',
        example: JSON.stringify({
          success: true,
          data: {
            count: 3,
            assets: [
              {
                id: 'med_01j7a',
                display_name: 'Product Front',
                storage_url: 'https://cdn.platform.com/raw.png',
                delivery_url: 'https://cdn.platform.com/api/v1/delivery/med_01j7a?w=600&format=webp&q=80'
              }
            ]
          }
        }, null, 2)
      }
    ],
    curlExample: `curl -X POST "https://api.media-platform.com/api/v1/assets/batch" \\
  -H "X-Media-Api-Key: mda_live_xxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"asset_ids":["med_01","med_02"],"transform":{"width":500,"format":"webp"}}'`,
    sdkExample: `const { assets } = await media.getAssetsBatch(
  ['med_prod_01', 'med_prod_02', 'med_prod_03'],
  {
    fields: ['id', 'display_name', 'storage_url'],
    transform: { width: 600, format: 'webp' }
  }
);`,
  },
  {
    id: 'upload-direct',
    method: 'POST',
    path: '/api/v1/uploads',
    category: 'Uploads',
    title: 'Direct Multipart Upload',
    description: 'Upload a binary file directly with deduplication check (SHA-256 checksum) and automated LQIP placeholder generation.',
    scopeRequired: 'uploads:create',
    requestBody: {
      contentType: 'multipart/form-data',
      schema: 'file: File, display_name?: string, folder_id?: string, visibility?: "workspace" | "public"',
      example: '[Form Data: file, display_name, folder_id]'
    },
    responses: [
      {
        status: 201,
        description: 'Asset created successfully',
        example: JSON.stringify({
          success: true,
          data: {
            id: 'med_01j7uploaded',
            display_name: 'Summer Lookbook 2026',
            mime_type: 'image/png',
            size_bytes: 148520,
            storage_url: 'https://cdn.platform.com/media-assets/...',
            status: 'active'
          }
        }, null, 2)
      }
    ],
    curlExample: `curl -X POST "https://api.media-platform.com/api/v1/uploads" \\
  -H "X-Media-Api-Key: mda_live_xxxxxxxxxxxxxxxx" \\
  -F "file=@photo.jpg" \\
  -F "display_name=Lookbook Cover" \\
  -F "visibility=public"`,
    sdkExample: `const asset = await media.upload(fileBlob, {
  displayName: 'Lookbook Cover',
  visibility: 'public',
  tags: ['lookbook', 'summer2026']
});`
  },
  {
    id: 'delivery-dynamic',
    method: 'GET',
    path: '/api/v1/delivery/{id}',
    category: 'Delivery',
    title: 'Dynamic Image Transformation & CDN Delivery',
    description: 'On-the-fly resizing, WebP/AVIF format transcoding, and compression with ETag (304 Not Modified) caching.',
    scopeRequired: 'Public CDN or assets:read',
    parameters: [
      { name: 'id', in: 'path', type: 'string', required: true, description: 'Asset ID', example: 'med_01j7a' },
      { name: 'w', in: 'query', type: 'integer', required: false, description: 'Target width in pixels', example: '800' },
      { name: 'h', in: 'query', type: 'integer', required: false, description: 'Target height in pixels', example: '600' },
      { name: 'format', in: 'query', type: 'webp | avif | png | jpeg', required: false, description: 'Output format (default: webp)', example: 'webp' },
      { name: 'q', in: 'query', type: 'integer (1-100)', required: false, description: 'Compression quality (default: 80)', example: '85' },
      { name: 'fit', in: 'query', type: 'cover | contain | fill | inside | outside', required: false, description: 'Resize crop fit strategy', example: 'cover' }
    ],
    responses: [
      {
        status: 200,
        description: 'Transformed binary image buffer with Cache-Control and ETag headers',
        example: '<binary image stream>'
      },
      {
        status: 304,
        description: 'Not Modified (ETag matched client cache, 0 bytes transferred)',
        example: '<empty body>'
      }
    ],
    curlExample: `curl -I -X GET "https://api.media-platform.com/api/v1/delivery/med_01j7a?w=800&format=webp&q=85" \\
  -H "If-None-Match: W/\"d41d8cd98f00b204e9800998ecf8427e\""`,
    sdkExample: `// 1. Get single delivery URL
const url = media.getDeliveryUrl('med_01j7a', { width: 800, format: 'webp', quality: 85 });

// 2. Generate responsive HTML <picture> / srcset
const responsive = media.getResponsivePictureSet('med_01j7a', {
  widths: [320, 640, 1080],
  formats: ['avif', 'webp']
});
console.log(responsive.html);`
  },
  {
    id: 'references-attach',
    method: 'POST',
    path: '/api/v1/references',
    category: 'References',
    title: 'Attach External Reference (Safe Delete Guard)',
    description: 'Lock a media asset by registering external entity usage (e.g. Product ID, Blog Post ID) to prevent accidental deletion in the DAM.',
    scopeRequired: 'references:write',
    requestBody: {
      contentType: 'application/json',
      schema: '{ asset_id: string; source_app: string; entity_type: string; entity_id: string; field_name?: string }',
      example: JSON.stringify({
        asset_id: 'med_01j7a',
        source_app: 'shopify-store',
        entity_type: 'product',
        entity_id: 'prod_summer_skirt_42',
        field_name: 'main_thumbnail'
      }, null, 2)
    },
    responses: [
      {
        status: 201,
        description: 'Reference registered and lock established',
        example: JSON.stringify({
          success: true,
          data: {
            id: 'ref_01j7locked',
            asset_id: 'med_01j7a',
            source_app: 'shopify-store',
            entity_id: 'prod_summer_skirt_42'
          }
        }, null, 2)
      }
    ],
    curlExample: `curl -X POST "https://api.media-platform.com/api/v1/references" \\
  -H "X-Media-Api-Key: mda_live_xxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"asset_id":"med_01","source_app":"crm","entity_type":"customer","entity_id":"cust_99"}'`,
    sdkExample: `await media.attachReference({
  assetId: 'med_01j7a',
  sourceApp: 'ecommerce',
  entityType: 'product',
  entityId: 'prod_dress_123',
  fieldName: 'hero'
});`
  },
  {
    id: 'webhooks-register',
    method: 'POST',
    path: '/api/v1/webhooks',
    category: 'Webhooks',
    title: 'Register Outbound Webhook',
    description: 'Subscribe to real-time events (asset.created, asset.deleted) with HMAC-SHA256 signature verification.',
    scopeRequired: 'webhooks:write',
    requestBody: {
      contentType: 'application/json',
      schema: '{ name: string; url: string; events: string[] }',
      example: JSON.stringify({
        name: 'Shopify Product Sync',
        url: 'https://api.store.com/webhooks/media',
        events: ['asset.created', 'asset.deleted']
      }, null, 2)
    },
    responses: [
      {
        status: 201,
        description: 'Webhook registered with secret for signature verification',
        example: JSON.stringify({
          success: true,
          data: {
            endpoint: { id: 'wh_01j7', name: 'Shopify Product Sync', url: 'https://api.store.com/webhooks/media', status: 'active' },
            signing_secret: 'whsec_e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
          }
        }, null, 2)
      }
    ],
    curlExample: `curl -X POST "https://api.media-platform.com/api/v1/webhooks" \\
  -H "X-Media-Api-Key: mda_live_xxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Inventory Sync","url":"https://api.app.com/wh","events":["*"]}'`,
    sdkExample: `// In your receiver server (Express / Next.js):
const isValid = MediaClient.verifyWebhookSignature(
  rawBody,
  req.headers['x-media-signature'],
  process.env.WEBHOOK_SIGNING_SECRET
);`,
  },
  {
    id: 'uploads-presigned',
    method: 'POST',
    path: '/api/v1/uploads/presigned',
    category: 'Uploads',
    title: 'Generate Direct-to-Storage Presigned Upload URL',
    description: 'Get a temporary cryptographically signed PUT/POST URL to upload directly to Supabase/S3 bucket with zero Next.js RAM overhead.',
    scopeRequired: 'uploads:create',
    requestBody: {
      contentType: 'application/json',
      schema: '{ filename: string; mime_type: string; size_bytes?: number; folder_id?: string; visibility?: string }',
      example: JSON.stringify({
        filename: 'product-hero-video.mp4',
        mime_type: 'video/mp4',
        size_bytes: 45000000,
        visibility: 'workspace'
      }, null, 2)
    },
    responses: [
      {
        status: 201,
        description: 'Presigned upload URL generated successfully',
        example: JSON.stringify({
          success: true,
          data: {
            asset_id: 'med_01j7xyz',
            upload_url: 'https://xxx.supabase.co/storage/v1/object/upload/sign/media-assets/uploads/...?token=...',
            storage_key: 'uploads/ws_default/1725890000_product.mp4',
            method: 'PUT',
            expires_in: 900
          }
        }, null, 2)
      }
    ],
    curlExample: `curl -X POST "https://api.media-platform.com/api/v1/uploads/presigned" \\
  -H "X-Media-Api-Key: mda_live_xxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"filename":"banner.png","mime_type":"image/png"}'`,
    sdkExample: `const presigned = await client.createPresignedUpload({
  filename: 'banner.png',
  mimeType: 'image/png'
});`
  },
  {
    id: 'uploads-confirm',
    method: 'POST',
    path: '/api/v1/uploads/confirm',
    category: 'Uploads',
    title: 'Confirm Presigned Direct Upload',
    description: 'Activate the asset record once direct upload to bucket completes, extracting dimensions and dominant color palette.',
    scopeRequired: 'uploads:create',
    requestBody: {
      contentType: 'application/json',
      schema: '{ asset_id: string; width?: number; height?: number; size_bytes?: number }',
      example: JSON.stringify({
        asset_id: 'med_01j7xyz'
      }, null, 2)
    },
    responses: [
      {
        status: 200,
        description: 'Asset confirmed and activated',
        example: JSON.stringify({
          success: true,
          data: {
            asset: { id: 'med_01j7xyz', status: 'active', processing_status: 'ready' }
          }
        }, null, 2)
      }
    ],
    curlExample: `curl -X POST "https://api.media-platform.com/api/v1/uploads/confirm" \\
  -H "X-Media-Api-Key: mda_live_xxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"asset_id":"med_01j7xyz"}'`,
    sdkExample: `const asset = await client.confirmUpload('med_01j7xyz');`
  },
  {
    id: 'assets-list-versions',
    method: 'GET',
    path: '/api/v1/assets/{id}/versions',
    category: 'Versioning',
    title: 'List Asset Version History',
    description: 'Retrieve the chronological version history of an asset (v1, v2, v3) with timestamps and comments.',
    scopeRequired: 'assets:read',
    responses: [
      {
        status: 200,
        description: 'Asset versions listed',
        example: JSON.stringify({
          success: true,
          data: [
            { id: 'ver_01j7', version_number: 1, size_bytes: 485200, created_at: '2026-09-08T10:00:00Z' }
          ]
        }, null, 2)
      }
    ],
    curlExample: `curl "https://api.media-platform.com/api/v1/assets/med_01j7xyz/versions" \\
  -H "X-Media-Api-Key: mda_live_xxxxxxxxxxxxxxxx"`,
    sdkExample: `const versions = await client.listVersions('med_01j7xyz');`
  },
  {
    id: 'assets-replace-version',
    method: 'POST',
    path: '/api/v1/assets/{id}/versions',
    category: 'Versioning',
    title: 'Replace Asset Version (In-Place ID Preservation)',
    description: 'Upload a newer revision of media while maintaining the exact same asset ID to prevent breaking external references.',
    scopeRequired: 'assets:write',
    requestBody: {
      contentType: 'application/json',
      schema: '{ storage_key: string; storage_url?: string; size_bytes?: number; mime_type?: string; comment?: string }',
      example: JSON.stringify({
        storage_key: 'uploads/ws_default/v2_logo.png',
        mime_type: 'image/png',
        comment: 'Updated brand typography'
      }, null, 2)
    },
    responses: [
      {
        status: 201,
        description: 'Version replaced and previous state archived',
        example: JSON.stringify({
          success: true,
          data: {
            versionNumber: 2,
            archivedVersion: { version_number: 1 },
            asset: { id: 'med_01j7xyz', metadata_json: { current_version: 2 } }
          }
        }, null, 2)
      }
    ],
    curlExample: `curl -X POST "https://api.media-platform.com/api/v1/assets/med_01j7xyz/versions" \\
  -H "X-Media-Api-Key: mda_live_xxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"storage_key":"uploads/v2.png","comment":"Rebrand"}'`,
    sdkExample: `const result = await client.replaceAsset('med_01j7xyz', {
  storageKey: 'uploads/v2.png',
  comment: 'Rebrand'
});`
  },
  {
    id: 'assets-rollback-version',
    method: 'POST',
    path: '/api/v1/assets/{id}/rollback',
    category: 'Versioning',
    title: 'Rollback Asset to Past Version',
    description: 'Instant zero-downtime rollback to any historical version number (e.g. restore v1).',
    scopeRequired: 'assets:write',
    requestBody: {
      contentType: 'application/json',
      schema: '{ version_number: number }',
      example: JSON.stringify({ version_number: 1 }, null, 2)
    },
    responses: [
      {
        status: 200,
        description: 'Asset rolled back',
        example: JSON.stringify({
          success: true,
          data: { message: 'Asset successfully rolled back to version 1' }
        }, null, 2)
      }
    ],
    curlExample: `curl -X POST "https://api.media-platform.com/api/v1/assets/med_01j7xyz/rollback" \\
  -H "X-Media-Api-Key: mda_live_xxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"version_number":1}'`,
    sdkExample: `await client.rollbackVersion('med_01j7xyz', 1);`
  },
  {
    id: 'analytics-summary',
    method: 'GET',
    path: '/api/v1/analytics',
    category: 'Analytics',
    title: 'Get CDN Analytics & Observability Metrics',
    description: 'Retrieve real-time telemetry: total requests, cache 304 hit rate, bandwidth saved, format distribution, and top media assets.',
    scopeRequired: 'analytics:read',
    parameters: [
      { name: 'period', in: 'query', type: 'string', required: false, description: 'Time window: "24h" | "7d" | "30d" (default: "24h")', example: '24h' }
    ],
    responses: [
      {
        status: 200,
        description: 'Analytics summary metrics retrieved',
        example: JSON.stringify({
          success: true,
          data: {
            totalRequests: 1420,
            cacheHits: 1080,
            cacheHitRate: 76.1,
            totalBytesTransferred: 45000000,
            totalBytesSaved: 120000000,
            bandwidthSavedPercent: 72.7,
            avgLatencyMs: 19
          }
        }, null, 2)
      }
    ],
    curlExample: `curl "https://api.media-platform.com/api/v1/analytics?period=24h" \\
  -H "X-Media-Api-Key: mda_live_xxxxxxxxxxxxxxxx"`,
    sdkExample: `const stats = await client.getAnalytics('24h');`
  }
];
