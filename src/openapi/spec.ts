import { PLATFORM_VERSION, API_VERSION } from '@/lib/platform/version';

/**
 * OpenAPI 3.1 Specification
 * Complete, machine-readable contract for Media Platform v3.8.
 */
export const openApiSpec: Record<string, any> = {
  openapi: '3.1.0',
  info: {
    title: 'Media Platform Headless & DAM API',
    version: PLATFORM_VERSION,
    description:
      'Enterprise Headless Digital Asset Management & Distributed Processing Engine for Image, Video HLS, Document & Archive lifecycle.',
    contact: {
      name: 'Media Platform Engineering',
      url: 'https://github.com/luannguen/mediaflatform',
    },
  },
  servers: [
    {
      url: '/api/v1',
      description: 'Primary v1 Gateway',
    },
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Media-Api-Key',
        description: 'Developer API Key with cryptographic prefix (e.g. mda_live_...)',
      },
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'API-Key',
        description: 'Bearer token authorization using API Key or Session Cookie',
      },
    },
    schemas: {
      StandardMeta: {
        type: 'object',
        properties: {
          request_id: { type: 'string', example: 'req_1j8m4k9a' },
          timestamp: { type: 'string', format: 'date-time' },
          total: { type: 'integer' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
      },
      ErrorResponse: {
        type: 'object',
        required: ['success', 'error'],
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            required: ['code', 'message', 'request_id'],
            properties: {
              code: { type: 'string', example: 'PERMISSION_DENIED' },
              message: { type: 'string', example: 'Operation forbidden for this resource' },
              request_id: { type: 'string', example: 'req_mtv_abc123' },
              details: { type: 'object', additionalProperties: true },
            },
          },
        },
      },
      Asset: {
        type: 'object',
        required: ['id', 'workspace_id', 'asset_type', 'original_filename', 'mime_type', 'size_bytes', 'visibility', 'status'],
        properties: {
          id: { type: 'string', example: 'med_fa2149b1c' },
          workspace_id: { type: 'string', example: 'ws_default' },
          folder_id: { type: 'string', nullable: true },
          asset_type: { type: 'string', enum: ['image', 'video', 'document', 'archive', 'other'] },
          original_filename: { type: 'string', example: 'product_photo.jpg' },
          display_name: { type: 'string', example: 'Hero Product' },
          mime_type: { type: 'string', example: 'image/jpeg' },
          size_bytes: { type: 'integer', example: 1048576 },
          visibility: { type: 'string', enum: ['public', 'workspace', 'private'] },
          status: { type: 'string', enum: ['active', 'quarantined', 'trashed', 'deleted'] },
          processing_status: { type: 'string', enum: ['pending', 'processing', 'ready', 'failed'] },
          active_output_version: { type: 'string', example: 'v1_fa50e54f' },
          storage_url: { type: 'string', example: 'https://cdn.yourdomain.com/api/v1/delivery/med_fa2149b1c' },
          metadata_json: { type: 'object', additionalProperties: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      AssetListResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'array',
            items: { $ref: '#/components/schemas/Asset' },
          },
          meta: { $ref: '#/components/schemas/StandardMeta' },
        },
      },
      AssetSingleResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: { $ref: '#/components/schemas/Asset' },
          meta: { $ref: '#/components/schemas/StandardMeta' },
        },
      },
      PresignedUploadRequest: {
        type: 'object',
        required: ['filename', 'mime_type', 'size_bytes'],
        properties: {
          filename: { type: 'string', example: 'banner.png' },
          mime_type: { type: 'string', example: 'image/png' },
          size_bytes: { type: 'integer', example: 204800 },
          folder_id: { type: 'string', nullable: true },
          visibility: { type: 'string', enum: ['public', 'workspace', 'private'], default: 'workspace' },
        },
      },
      PresignedUploadResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: {
              asset_id: { type: 'string', example: 'med_fa2149b1c' },
              storage_key: { type: 'string', example: 'images/med_fa2149b1c/source.png' },
              upload_url: { type: 'string' },
              expires_at: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
      ReferenceSyncRequest: {
        type: 'object',
        required: ['source_app', 'entity_type', 'entity_id', 'references'],
        properties: {
          source_app: { type: 'string', example: 'ecommerce_web' },
          entity_type: { type: 'string', example: 'product' },
          entity_id: { type: 'string', example: 'prod_9999' },
          references: {
            type: 'array',
            items: {
              type: 'object',
              required: ['asset_id'],
              properties: {
                asset_id: { type: 'string', example: 'med_fa2149b1c' },
                field_name: { type: 'string', example: 'hero_image' },
                context: { type: 'object', additionalProperties: true },
              },
            },
          },
        },
      },
      CapabilitiesResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: {
              api_version: { type: 'string', example: 'v1' },
              platform_version: { type: 'string', example: '3.8.2' },
              processors: { type: 'object' },
              features: { type: 'object' },
              limits: { type: 'object' },
            },
          },
        },
      },
      UsageResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: {
              workspaceId: { type: 'string' },
              storage: {
                type: 'object',
                properties: {
                  usedBytes: { type: 'integer' },
                  limitBytes: { type: 'integer' },
                  usagePercent: { type: 'number' },
                },
              },
              assets: {
                type: 'object',
                properties: {
                  totalCount: { type: 'integer' },
                  limitCount: { type: 'integer' },
                  usagePercent: { type: 'number' },
                  breakdown: { type: 'object' },
                },
              },
              metrics: { type: 'object' },
            },
          },
        },
      },
      HealthResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'degraded', 'failed', 'not_ready'] },
          service: { type: 'string' },
          platform_version: { type: 'string' },
          api_version: { type: 'string' },
          timestamp: { type: 'string', format: 'date-time' },
          checks: { type: 'object' },
        },
      },
      WorkerFleetResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: {
              total_workers: { type: 'integer' },
              active_workers: { type: 'integer' },
              stale_workers: { type: 'integer' },
              workers: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    worker_id: { type: 'string' },
                    hostname: { type: 'string' },
                    status: { type: 'string' },
                    last_heartbeat_at: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      ApiKey: {
        type: 'object',
        required: ['id', 'workspace_id', 'service_account_id', 'name', 'key_prefix', 'scopes', 'status', 'created_at'],
        properties: {
          id: { type: 'string', example: 'key_fa9128bc' },
          workspace_id: { type: 'string', example: 'ws_default' },
          service_account_id: { type: 'string', example: 'svc_live_app' },
          name: { type: 'string', example: 'Production Backend Key' },
          key_prefix: { type: 'string', example: 'mda_live_9a8b7c6d' },
          scopes: { type: 'array', items: { type: 'string' }, example: ['assets:read', 'assets:write'] },
          status: { type: 'string', enum: ['active', 'expired', 'revoked'] },
          expires_at: { type: 'string', format: 'date-time', nullable: true },
          last_used_at: { type: 'string', format: 'date-time', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          revoked_at: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      WebhookEndpoint: {
        type: 'object',
        required: ['id', 'workspace_id', 'target_url', 'events', 'status', 'created_at'],
        properties: {
          id: { type: 'string', example: 'wh_fa81b9c2' },
          workspace_id: { type: 'string', example: 'ws_default' },
          target_url: { type: 'string', example: 'https://api.yourdomain.com/webhooks/media' },
          events: { type: 'array', items: { type: 'string' }, example: ['asset.ready', 'asset.failed'] },
          status: { type: 'string', enum: ['active', 'disabled', 'failing'] },
          description: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      WorkspaceUsage: {
        type: 'object',
        required: ['workspaceId', 'storage', 'assets', 'metrics'],
        properties: {
          workspaceId: { type: 'string' },
          storage: {
            type: 'object',
            properties: {
              usedBytes: { type: 'integer' },
              limitBytes: { type: 'integer' },
              usagePercent: { type: 'number' },
            },
          },
          assets: {
            type: 'object',
            properties: {
              totalCount: { type: 'integer' },
              limitCount: { type: 'integer' },
              usagePercent: { type: 'number' },
              breakdown: { type: 'object' },
            },
          },
          metrics: { type: 'object' },
        },
      },
      Capabilities: {
        type: 'object',
        required: ['api_version', 'platform_version', 'processors', 'features', 'limits'],
        properties: {
          api_version: { type: 'string', example: 'v1' },
          platform_version: { type: 'string', example: '3.8.2' },
          processors: { type: 'object' },
          features: { type: 'object' },
          limits: { type: 'object' },
        },
      },
      HealthLive: {
        type: 'object',
        required: ['status', 'service', 'platform_version', 'api_version', 'timestamp'],
        properties: {
          status: { type: 'string', enum: ['ok'] },
          service: { type: 'string', example: 'media-platform-api' },
          platform_version: { type: 'string', example: '3.8.2' },
          api_version: { type: 'string', example: 'v1' },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
      HealthDeep: {
        type: 'object',
        required: ['status', 'service', 'platform_version', 'api_version', 'timestamp', 'checks'],
        properties: {
          status: { type: 'string', enum: ['ok', 'degraded', 'failed'] },
          service: { type: 'string', example: 'media-platform-api' },
          platform_version: { type: 'string', example: '3.8.2' },
          api_version: { type: 'string', example: 'v1' },
          timestamp: { type: 'string', format: 'date-time' },
          checks: { type: 'object' },
        },
      },
    },
    parameters: {
      RequestIdHeader: {
        name: 'X-Request-Id',
        in: 'header',
        required: false,
        schema: { type: 'string' },
        description: 'Optional client correlation ID. Sanitized and propagated.',
      },
      IdempotencyKeyHeader: {
        name: 'Idempotency-Key',
        in: 'header',
        required: false,
        schema: { type: 'string' },
        description: 'Unique idempotency key preventing duplicate mutation execution.',
      },
    },
  },
  security: [
    { ApiKeyAuth: [] },
    { BearerAuth: [] },
  ],
  paths: {
    '/health/live': {
      get: {
        operationId: 'getLiveness',
        summary: 'Liveness Probe',
        description: 'Fast, dependency-free in-memory process check (<5ms).',
        security: [],
        responses: {
          '200': {
            description: 'Process alive',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } },
          },
        },
      },
    },
    '/health/ready': {
      get: {
        operationId: 'getReadiness',
        summary: 'Readiness Probe',
        description: 'Verifies PostgreSQL database and Object Storage connectivity.',
        security: [],
        responses: {
          '200': {
            description: 'Ready to accept traffic',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } },
          },
          '503': {
            description: 'Service Not Ready',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/health/deep': {
      get: {
        operationId: 'getDeepHealth',
        summary: 'Deep Diagnostics Probe',
        description: 'Executes storage write-read-delete probe, verifies RPCs, queue depth, and worker fleet.',
        security: [{ ApiKeyAuth: ['system:read'] }],
        responses: {
          '200': {
            description: 'Deep health diagnostic status',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } },
          },
          '403': {
            description: 'Forbidden',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/capabilities': {
      get: {
        operationId: 'getCapabilities',
        summary: 'Platform Capabilities Discovery',
        description: 'Machine-readable runtime capabilities, engines, ladders, and limits.',
        security: [],
        responses: {
          '200': {
            description: 'Capabilities payload',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CapabilitiesResponse' } } },
          },
        },
      },
    },
    '/usage': {
      get: {
        operationId: 'getWorkspaceUsage',
        summary: 'Workspace Usage & Quota',
        description: 'Calculates storage bytes, asset count, transforms, and quota usage.',
        security: [{ ApiKeyAuth: ['usage:read'] }],
        responses: {
          '200': {
            description: 'Usage summary',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UsageResponse' } } },
          },
        },
      },
    },
    '/developer/diagnostics': {
      get: {
        operationId: 'getDeveloperDiagnostics',
        summary: 'Developer Self-Diagnostics',
        description: 'Inspects caller authentication context, scopes, and quota without leaking secrets.',
        responses: {
          '200': {
            description: 'Diagnostics context',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
    '/developer/keys': {
      get: {
        operationId: 'listApiKeys',
        summary: 'List API Keys',
        description: 'List active and rotated API keys for the workspace.',
        responses: {
          '200': {
            description: 'List of API keys',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
      post: {
        operationId: 'createApiKey',
        summary: 'Create API Key',
        description: 'Create a new cryptographic API key. Secret returned once.',
        responses: {
          '201': {
            description: 'Key created',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
    '/developer/keys/{id}/rotate': {
      post: {
        operationId: 'rotateApiKey',
        summary: 'Rotate API Key',
        description: 'Rotates an existing key with zero downtime using an overlapping grace period.',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'New key generated and old key set with expiration',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
    '/developer/logs': {
      get: {
        operationId: 'listDeveloperLogs',
        summary: 'Query API Request Logs',
        description: 'Search and inspect API request logs with secrets redacted.',
        parameters: [
          { name: 'route', in: 'query', schema: { type: 'string' } },
          { name: 'status_code', in: 'query', schema: { type: 'integer' } },
          { name: 'request_id', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Filtered logs',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
    '/admin/workers': {
      get: {
        operationId: 'listWorkerFleet',
        summary: 'Worker Fleet Visibility',
        description: 'List active worker instances with heartbeats and status.',
        security: [{ ApiKeyAuth: ['admin:manage'] }],
        responses: {
          '200': {
            description: 'Fleet summary and worker listing',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/WorkerFleetResponse' } } },
          },
        },
      },
    },
    '/uploads': {
      post: {
        operationId: 'uploadDirect',
        summary: 'Direct Multipart File Upload',
        description: 'Upload file buffer directly to DAM, computing SHA-256 and enqueuing processing.',
        parameters: [{ $ref: '#/components/parameters/IdempotencyKeyHeader' }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: {
                  file: { type: 'string', format: 'binary' },
                  display_name: { type: 'string' },
                  folder_id: { type: 'string' },
                  visibility: { type: 'string', enum: ['public', 'workspace', 'private'] },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'File uploaded and asset created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AssetSingleResponse' } } },
          },
        },
      },
    },
    '/uploads/presigned': {
      post: {
        operationId: 'createPresignedUploadSession',
        summary: 'Create Presigned Upload Session',
        description: 'Initializes an upload session and provides direct upload credentials.',
        parameters: [{ $ref: '#/components/parameters/IdempotencyKeyHeader' }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/PresignedUploadRequest' } },
          },
        },
        responses: {
          '201': {
            description: 'Upload session created',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/PresignedUploadResponse' } } },
          },
        },
      },
    },
    '/uploads/confirm': {
      post: {
        operationId: 'confirmUpload',
        summary: 'Confirm Upload & Enqueue Processing',
        description: 'Performs magic byte inspection, auto-quarantine, and enqueues job.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['asset_id'],
                properties: { asset_id: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Upload confirmed',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AssetSingleResponse' } } },
          },
          '400': {
            description: 'MIME spoof or missing storage object',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/assets': {
      get: {
        operationId: 'listAssets',
        summary: 'List Assets',
        description: 'List assets in workspace with search, filtering, and pagination.',
        responses: {
          '200': {
            description: 'Asset list',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AssetListResponse' } } },
          },
        },
      },
    },
    '/assets/{id}': {
      get: {
        operationId: 'getAsset',
        summary: 'Get Asset Metadata',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Asset record',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AssetSingleResponse' } } },
          },
        },
      },
      patch: {
        operationId: 'updateAsset',
        summary: 'Update Asset Metadata',
        description: 'Update display name, description, tags, focal point. Rejects immutable fields.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Asset updated',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AssetSingleResponse' } } },
          },
          '400': {
            description: 'IMMUTABLE_FIELD_MUTATION',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
      delete: {
        operationId: 'deleteAsset',
        summary: 'Delete or Purge Asset',
        description: 'Soft delete to trash or force purge. Protected by active reference sync locks.',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'action', in: 'query', schema: { type: 'string', enum: ['trash', 'purge'] } },
          { name: 'force', in: 'query', schema: { type: 'boolean' } },
        ],
        responses: {
          '200': {
            description: 'Asset deleted or moved to trash',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          '409': {
            description: 'ASSET_IN_USE - Active references exist',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        },
      },
    },
    '/assets/{id}/references': {
      post: {
        operationId: 'attachReference',
        summary: 'Register Asset Reference',
        description: 'Registers external application entity reference to prevent accidental deletion.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Reference registered',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
    '/references/sync': {
      post: {
        operationId: 'syncReferences',
        summary: 'Atomic Reference Sync',
        description: 'Atomically synchronizes all entity references for an external resource.',
        parameters: [{ $ref: '#/components/parameters/IdempotencyKeyHeader' }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ReferenceSyncRequest' } },
          },
        },
        responses: {
          '200': {
            description: 'References synchronized atomically',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
    '/webhooks/deliveries/{id}/replay': {
      post: {
        operationId: 'replayWebhookDelivery',
        summary: 'Safe Webhook Replay',
        description: 'Replays a past webhook delivery with immutable audit retention.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Delivery replayed',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
    '/delivery/{id}': {
      get: {
        operationId: 'deliverAsset',
        summary: 'Universal Delivery Gateway',
        description: 'Dynamic on-the-fly transformation with AVIF/WebP auto-negotiation and CDN caching.',
        security: [],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'w', in: 'query', schema: { type: 'integer' } },
          { name: 'h', in: 'query', schema: { type: 'integer' } },
          { name: 'format', in: 'query', schema: { type: 'string', enum: ['webp', 'avif', 'jpeg', 'png'] } },
          { name: 'q', in: 'query', schema: { type: 'integer' } },
          { name: 'fit', in: 'query', schema: { type: 'string', enum: ['cover', 'contain', 'inside', 'outside', 'smart'] } },
        ],
        responses: {
          '200': { description: 'Optimized binary image or file stream' },
          '304': { description: 'Not Modified (Conditional Cache Hit)' },
          '400': { description: 'IMAGE_DIMENSION_LIMIT_EXCEEDED or DECOMPRESSION_BOMB_PREVENTED' },
          '403': { description: 'ASSET_QUARANTINED or PERMISSION_DENIED' },
          '404': { description: 'ASSET_NOT_FOUND' },
        },
      },
    },
    '/delivery/video/{id}/master.m3u8': {
      get: {
        operationId: 'deliverHlsMaster',
        summary: 'Adaptive HLS Master Playlist',
        description: 'Delivers standardized HLS master playlist with multi-bitrate 30fps ladders.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'HLS Master Playlist' },
          '425': { description: 'TOO_EARLY (Transcoding in progress)' },
          '503': { description: 'MEDIA_ARTIFACT_MISSING' },
        },
      },
    },
    '/webhooks': {
      get: {
        operationId: 'listWebhooks',
        summary: 'List Webhook Endpoints',
        responses: {
          '200': { description: 'Endpoints list', content: { 'application/json': { schema: { type: 'object' } } } },
        },
      },
      post: {
        operationId: 'createWebhook',
        summary: 'Register Webhook Endpoint',
        responses: {
          '201': { description: 'Endpoint registered with HMAC signing secret', content: { 'application/json': { schema: { type: 'object' } } } },
        },
      },
    },
    '/developer/apps': {
      get: {
        operationId: 'listApplications',
        summary: 'List Developer Applications',
        responses: {
          '200': { description: 'Applications list', content: { 'application/json': { schema: { type: 'object' } } } },
        },
      },
      post: {
        operationId: 'createApplication',
        summary: 'Register Developer Application',
        responses: {
          '201': { description: 'Application registered', content: { 'application/json': { schema: { type: 'object' } } } },
        },
      },
    },
  },
};
