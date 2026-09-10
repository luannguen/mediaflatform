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
          metadata_json: { type: 'object', additionalProperties: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
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
          asset_id: { type: 'string', example: 'med_fa2149b1c' },
          storage_key: { type: 'string', example: 'images/med_fa2149b1c/source.png' },
          upload_url: { type: 'string' },
          expires_at: { type: 'string', format: 'date-time' },
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
          api_version: { type: 'string', example: 'v1' },
          platform_version: { type: 'string', example: '3.8.0' },
          processors: { type: 'object' },
          features: { type: 'object' },
          limits: { type: 'object' },
        },
      },
      UsageResponse: {
        type: 'object',
        properties: {
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
        summary: 'Liveness Probe',
        description: 'Fast, dependency-free in-memory process check.',
        security: [],
        responses: {
          '200': { description: 'Process alive' },
        },
      },
    },
    '/health/ready': {
      get: {
        summary: 'Readiness Probe',
        description: 'Verifies PostgreSQL database and Object Storage connectivity.',
        security: [],
        responses: {
          '200': { description: 'Ready to accept traffic' },
          '503': { description: 'Service Not Ready' },
        },
      },
    },
    '/health/deep': {
      get: {
        summary: 'Deep Diagnostics Probe',
        description: 'Executes storage write-read-delete probe, verifies RPCs, queue depth, and worker fleet.',
        security: [{ ApiKeyAuth: ['system:read'] }],
        responses: {
          '200': { description: 'Deep health diagnostic status' },
          '403': { description: 'Forbidden' },
        },
      },
    },
    '/capabilities': {
      get: {
        summary: 'Platform Capabilities Discovery',
        description: 'Machine-readable runtime capabilities, engines, ladders, and limits.',
        security: [],
        responses: {
          '200': { description: 'Capabilities payload' },
        },
      },
    },
    '/usage': {
      get: {
        summary: 'Workspace Usage & Quota',
        description: 'Calculates storage bytes, asset count, transforms, and quota usage.',
        security: [{ ApiKeyAuth: ['usage:read'] }],
        responses: {
          '200': { description: 'Usage summary' },
        },
      },
    },
    '/developer/diagnostics': {
      get: {
        summary: 'Developer Self-Diagnostics',
        description: 'Inspects caller authentication context, scopes, and quota without leaking secrets.',
        responses: {
          '200': { description: 'Diagnostics context' },
        },
      },
    },
    '/developer/keys': {
      get: {
        summary: 'List API Keys',
        description: 'List active and rotated API keys for the workspace.',
        responses: {
          '200': { description: 'List of API keys' },
        },
      },
      post: {
        summary: 'Create API Key',
        description: 'Create a new cryptographic API key. Secret returned once.',
        responses: {
          '201': { description: 'Key created' },
        },
      },
    },
    '/developer/keys/{id}/rotate': {
      post: {
        summary: 'Rotate API Key',
        description: 'Rotates an existing key with zero downtime using an overlapping grace period.',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'New key generated and old key set with expiration' },
        },
      },
    },
    '/developer/logs': {
      get: {
        summary: 'Query API Request Logs',
        description: 'Search and inspect API request logs with secrets redacted.',
        parameters: [
          { name: 'route', in: 'query', schema: { type: 'string' } },
          { name: 'status_code', in: 'query', schema: { type: 'integer' } },
          { name: 'request_id', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Filtered logs' },
        },
      },
    },
    '/uploads/presigned': {
      post: {
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
          '201': { description: 'Upload session created' },
        },
      },
    },
    '/uploads/confirm': {
      post: {
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
          '200': { description: 'Upload confirmed' },
          '400': { description: 'MIME spoof or missing storage object' },
        },
      },
    },
    '/assets': {
      get: {
        summary: 'List Assets',
        description: 'List assets in workspace with search, filtering, and pagination.',
        responses: {
          '200': { description: 'Asset list' },
        },
      },
    },
    '/assets/{id}': {
      get: {
        summary: 'Get Asset Metadata',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Asset record' },
        },
      },
      patch: {
        summary: 'Update Asset Metadata',
        description: 'Update display name, description, tags, focal point. Rejects immutable fields.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Asset updated' },
          '400': { description: 'IMMUTABLE_FIELD_MUTATION' },
        },
      },
      delete: {
        summary: 'Delete or Purge Asset',
        description: 'Trash asset or permanently purge. Blocked with 409 ASSET_IN_USE if referenced.',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'action', in: 'query', schema: { type: 'string', enum: ['trash', 'purge'] } },
          { name: 'force', in: 'query', schema: { type: 'boolean' } },
        ],
        responses: {
          '200': { description: 'Asset deleted or purged' },
          '409': { description: 'ASSET_IN_USE' },
        },
      },
    },
    '/delivery/{id}': {
      get: {
        summary: 'Media Delivery & On-Demand Transform',
        description: 'Delivers canonical variants or dynamically transformed WebP/AVIF with deterministic cache.',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'w', in: 'query', schema: { type: 'integer' }, description: 'Width <= 4096' },
          { name: 'h', in: 'query', schema: { type: 'integer' }, description: 'Height <= 4096' },
          { name: 'q', in: 'query', schema: { type: 'integer' } },
          { name: 'format', in: 'query', schema: { type: 'string', enum: ['webp', 'png', 'jpeg', 'avif'] } },
        ],
        responses: {
          '200': { description: 'Binary media stream' },
          '304': { description: 'Not Modified' },
          '400': { description: 'IMAGE_DIMENSION_LIMIT_EXCEEDED' },
          '403': { description: 'Forbidden (private or quarantined)' },
        },
      },
    },
    '/delivery/video/{id}/master.m3u8': {
      get: {
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
    '/references/sync': {
      post: {
        summary: 'Transactional Reference Sync',
        description: 'Atomically syncs consumer entity references (Safe Delete).',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ReferenceSyncRequest' } },
          },
        },
        responses: {
          '200': { description: 'References synchronized' },
        },
      },
    },
    '/webhooks': {
      get: {
        summary: 'List Webhook Endpoints',
        responses: {
          '200': { description: 'Endpoints list' },
        },
      },
      post: {
        summary: 'Register Webhook Endpoint',
        responses: {
          '201': { description: 'Endpoint registered with HMAC signing secret' },
        },
      },
    },
    '/webhooks/deliveries/{id}/replay': {
      post: {
        summary: 'Replay Webhook Delivery',
        description: 'Re-dispatches a delivery attempt with historical immutability.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'New delivery attempt created' },
        },
      },
    },
    '/admin/workers': {
      get: {
        summary: 'List Worker Fleet (Admin)',
        description: 'Inspects distributed compute fleet, heartbeats, and status.',
        security: [{ ApiKeyAuth: ['system:read'] }],
        responses: {
          '200': { description: 'Fleet status list' },
        },
      },
    },
  },
};
