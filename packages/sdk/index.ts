/**
 * @media-platform/sdk v3.8.0
 * Official TypeScript Client SDK for Media Platform
 * Universal (Node.js 18+, Modern Browsers, Cloudflare Workers, Edge Runtimes)
 */

export interface MediaPlatformClientConfig {
  apiKey: string;
  baseUrl?: string;
  maxRetries?: number;
  retryInitialDelayMs?: number;
  retryMaxDelayMs?: number;
  timeoutMs?: number;
  defaultHeaders?: Record<string, string>;
}

export interface RequestOptions extends RequestInit {
  idempotencyKey?: string;
  requestId?: string;
  skipRetry?: boolean;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data: T;
  meta?: {
    request_id?: string;
    timestamp?: string;
    total?: number;
    page?: number;
    limit?: number;
    [key: string]: any;
  };
  error?: {
    code: string;
    message: string;
    request_id?: string;
    details?: any;
  };
}

export class MediaPlatformError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId?: string;
  readonly details?: any;

  constructor(message: string, code: string, status: number, requestId?: string, details?: any) {
    super(message);
    this.name = 'MediaPlatformError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.details = details;
    Object.setPrototypeOf(this, MediaPlatformError.prototype);
  }

  override toString(): string {
    return `MediaPlatformError [${this.code}] (${this.status}): ${this.message} (Request ID: ${this.requestId || 'unknown'})`;
  }
}

export interface Asset {
  id: string;
  workspace_id: string;
  folder_id?: string | null;
  asset_type: 'image' | 'video' | 'document' | 'archive' | 'other';
  original_filename: string;
  display_name: string;
  mime_type: string;
  size_bytes: number;
  visibility: 'public' | 'workspace' | 'private';
  status: 'active' | 'quarantined' | 'trashed' | 'deleted';
  processing_status: 'pending' | 'processing' | 'ready' | 'failed';
  active_output_version?: string;
  storage_url?: string;
  metadata_json?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface ListAssetsParams {
  folder_id?: string | null;
  asset_type?: string;
  visibility?: string;
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface UploadOptions {
  displayName?: string;
  folderId?: string | null;
  tags?: string[];
  visibility?: 'private' | 'workspace' | 'public';
  metadata?: Record<string, any>;
}

export interface PresignedUploadOptions {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  folderId?: string | null;
  visibility?: 'private' | 'workspace' | 'public';
}

export interface TransformOptions {
  width?: number;
  height?: number;
  format?: 'webp' | 'png' | 'jpeg' | 'avif';
  quality?: number;
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside' | 'smart';
  watermark?: string;
  watermarkPos?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'center';
  watermarkOpacity?: number;
}

export interface AttachReferenceInput {
  assetId: string;
  sourceApp: string;
  entityType: string;
  entityId: string;
  fieldName?: string;
  context?: Record<string, any>;
}

export interface UsageQuota {
  workspace_id: string;
  plan_tier: string;
  storage: {
    used_bytes: number;
    quota_bytes: number;
    usage_percent: number;
  };
  bandwidth: {
    used_bytes: number;
    quota_bytes: number;
    usage_percent: number;
  };
  assets: {
    total_count: number;
    video_count: number;
    image_count: number;
    document_count: number;
  };
}

export class MediaPlatformClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly retryInitialDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly timeoutMs: number;
  private readonly defaultHeaders: Record<string, string>;

  constructor(config: MediaPlatformClientConfig) {
    if (!config || !config.apiKey) {
      throw new Error('MediaPlatformClient: "apiKey" is required.');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || 'http://localhost:3000').replace(/\/$/, '');
    this.maxRetries = config.maxRetries ?? 3;
    this.retryInitialDelayMs = config.retryInitialDelayMs ?? 300;
    this.retryMaxDelayMs = config.retryMaxDelayMs ?? 5000;
    this.timeoutMs = config.timeoutMs ?? 30000;
    this.defaultHeaders = config.defaultHeaders || {};
  }

  // Sub-resource namespaces
  readonly assets = {
    list: (params?: ListAssetsParams, options?: RequestOptions) => this.listAssets(params, options),
    get: (id: string, options?: RequestOptions) => this.getAsset(id, options),
    upload: (fileOrBlob: File | Blob | ArrayBuffer | Uint8Array, options?: UploadOptions, reqOptions?: RequestOptions) =>
      this.uploadAsset(fileOrBlob, options, reqOptions),
    createUploadSession: (options: PresignedUploadOptions, reqOptions?: RequestOptions) =>
      this.createUploadSession(options, reqOptions),
    delete: (id: string, options?: { permanent?: boolean }, reqOptions?: RequestOptions) =>
      this.deleteAsset(id, options, reqOptions),
    getDeliveryUrl: (id: string, options?: TransformOptions) => this.getDeliveryUrl(id, options),
    attachReference: (input: AttachReferenceInput, options?: RequestOptions) => this.attachReference(input, options),
  };

  readonly usage = {
    get: (options?: RequestOptions) => this.getUsage(options),
  };

  readonly health = {
    live: (options?: RequestOptions) => this.request<any>('/api/v1/health/live', { ...options, skipRetry: true }),
    ready: (options?: RequestOptions) => this.request<any>('/api/v1/health/ready', { ...options, skipRetry: true }),
    deep: (options?: RequestOptions) => this.request<any>('/api/v1/health/deep', { ...options, skipRetry: true }),
  };

  readonly developer = {
    getDiagnostics: (options?: RequestOptions) => this.request<any>('/api/v1/developer/diagnostics', options),
    getCapabilities: (options?: RequestOptions) => this.request<any>('/api/v1/capabilities', options),
    getLogs: (params?: { limit?: number; offset?: number; status?: number }, options?: RequestOptions) => {
      const q = new URLSearchParams();
      if (params?.limit) q.set('limit', String(params.limit));
      if (params?.offset) q.set('offset', String(params.offset));
      if (params?.status) q.set('status', String(params.status));
      const qs = q.toString();
      return this.request<any>(`/api/v1/developer/logs${qs ? `?${qs}` : ''}`, options);
    },
  };

  readonly webhooks = {
    replayDelivery: (deliveryId: string, options?: RequestOptions) =>
      this.request<any>(`/api/v1/webhooks/deliveries/${deliveryId}/replay`, {
        method: 'POST',
        ...options,
      }),
  };

  /**
   * Internal HTTP request dispatcher with retry, jitter, timeout, and context propagation
   */
  async request<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const method = (options.method || 'GET').toUpperCase();
    const requestId = options.requestId || `req_sdk_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;

    const headers = new Headers(options.headers || {});
    headers.set('X-Media-Api-Key', this.apiKey);
    headers.set('X-Request-Id', requestId);
    headers.set('User-Agent', '@media-platform/sdk/3.8.0');

    // Attach default headers
    for (const [k, v] of Object.entries(this.defaultHeaders)) {
      if (!headers.has(k)) headers.set(k, v);
    }

    // Attach idempotency key if mutation
    if (options.idempotencyKey) {
      headers.set('Idempotency-Key', options.idempotencyKey);
    }

    if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }

    let attempt = 0;
    const maxRetries = options.skipRetry ? 0 : this.maxRetries;

    while (true) {
      attempt++;
      try {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;

        const response = await fetch(url, {
          ...options,
          method,
          headers,
          signal: options.signal || controller?.signal,
        });

        if (timer) clearTimeout(timer);

        const responseRequestId = response.headers.get('x-request-id') || requestId;
        const text = await response.text();
        let json: any = null;
        try {
          json = text ? JSON.parse(text) : {};
        } catch {
          json = { raw: text };
        }

        if (response.ok) {
          return (json && json.data !== undefined ? json.data : json) as T;
        }

        // Retryable status: 429 Too Many Requests, 502 Bad Gateway, 503 Service Unavailable, 504 Gateway Timeout
        const isRetryable = [429, 502, 503, 504].includes(response.status);
        if (isRetryable && attempt <= maxRetries) {
          let delayMs = this.calculateBackoff(attempt);
          const retryAfterHeader = response.headers.get('retry-after');
          if (retryAfterHeader) {
            const seconds = parseInt(retryAfterHeader, 10);
            if (!isNaN(seconds)) delayMs = Math.min(seconds * 1000, this.retryMaxDelayMs);
          }
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }

        const errorMessage = json?.error?.message || `HTTP ${response.status}: Request to ${path} failed`;
        const errorCode = json?.error?.code || (response.status === 429 ? 'RATE_LIMIT_EXCEEDED' : 'API_ERROR');
        throw new MediaPlatformError(errorMessage, errorCode, response.status, responseRequestId, json?.error?.details);
      } catch (err: any) {
        if (err instanceof MediaPlatformError) throw err;

        // Network error retry
        if (attempt <= maxRetries && !options.skipRetry) {
          const delayMs = this.calculateBackoff(attempt);
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }

        throw new MediaPlatformError(
          err.message || 'Network request failed',
          err.name === 'AbortError' ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
          0,
          requestId
        );
      }
    }
  }

  private calculateBackoff(attempt: number): number {
    const exponential = Math.min(this.retryMaxDelayMs, this.retryInitialDelayMs * Math.pow(2, attempt - 1));
    // Full jitter between 0 and exponential delay
    return Math.floor(Math.random() * exponential);
  }

  // --- High-level Asset Operations ---

  async listAssets(params?: ListAssetsParams, options?: RequestOptions): Promise<{ assets: Asset[]; total?: number }> {
    const query = new URLSearchParams();
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) query.set(k, String(v));
      }
    }
    const qs = query.toString();
    return this.request<{ assets: Asset[]; total?: number }>(`/api/v1/assets${qs ? `?${qs}` : ''}`, {
      method: 'GET',
      ...options,
    });
  }

  async getAsset(id: string, options?: RequestOptions): Promise<Asset> {
    return this.request<Asset>(`/api/v1/assets/${id}`, {
      method: 'GET',
      ...options,
    });
  }

  async createUploadSession(
    opts: PresignedUploadOptions,
    options?: RequestOptions
  ): Promise<{ asset_id: string; upload_url: string; storage_key: string; expires_at: string }> {
    return this.request('/api/v1/uploads/presigned', {
      method: 'POST',
      body: JSON.stringify({
        filename: opts.filename,
        mime_type: opts.mimeType,
        size_bytes: opts.sizeBytes,
        folder_id: opts.folderId || null,
        visibility: opts.visibility || 'workspace',
      }),
      ...options,
    });
  }

  async uploadAsset(
    fileOrBlob: File | Blob | ArrayBuffer | Uint8Array,
    opts: UploadOptions = {},
    options?: RequestOptions
  ): Promise<Asset> {
    const formData = new FormData();
    if (fileOrBlob instanceof Blob || (typeof File !== 'undefined' && fileOrBlob instanceof File)) {
      formData.append('file', fileOrBlob);
    } else {
      const blob = new Blob([fileOrBlob as any]);
      formData.append('file', blob, opts.displayName || 'uploaded-file');
    }

    if (opts.displayName) formData.append('display_name', opts.displayName);
    if (opts.folderId) formData.append('folder_id', opts.folderId);
    if (opts.visibility) formData.append('visibility', opts.visibility);
    if (opts.tags && opts.tags.length > 0) formData.append('tags', JSON.stringify(opts.tags));
    if (opts.metadata) formData.append('metadata', JSON.stringify(opts.metadata));

    return this.request<Asset>('/api/v1/uploads/direct', {
      method: 'POST',
      body: formData,
      ...options,
    });
  }

  async deleteAsset(id: string, opts?: { permanent?: boolean }, options?: RequestOptions): Promise<{ success: boolean; deleted_id: string }> {
    const qs = opts?.permanent ? '?permanent=true' : '';
    return this.request(`/api/v1/assets/${id}${qs}`, {
      method: 'DELETE',
      ...options,
    });
  }

  getDeliveryUrl(assetId: string, transform?: TransformOptions): string {
    const params = new URLSearchParams();
    if (transform) {
      if (transform.width) params.set('w', String(transform.width));
      if (transform.height) params.set('h', String(transform.height));
      if (transform.format) params.set('format', transform.format);
      if (transform.quality) params.set('q', String(transform.quality));
      if (transform.fit) params.set('fit', transform.fit);
      if (transform.watermark) params.set('watermark', transform.watermark);
      if (transform.watermarkPos) params.set('watermarkPos', transform.watermarkPos);
      if (transform.watermarkOpacity !== undefined) params.set('watermarkOpacity', String(transform.watermarkOpacity));
    }
    const query = params.toString();
    return `${this.baseUrl}/api/v1/delivery/${assetId}${query ? `?${query}` : ''}`;
  }

  async attachReference(input: AttachReferenceInput, options?: RequestOptions): Promise<any> {
    return this.request(`/api/v1/assets/${input.assetId}/references`, {
      method: 'POST',
      body: JSON.stringify({
        source_app: input.sourceApp,
        entity_type: input.entityType,
        entity_id: input.entityId,
        field_name: input.fieldName || 'media',
        context: input.context || {},
      }),
      ...options,
    });
  }

  async getUsage(options?: RequestOptions): Promise<UsageQuota> {
    return this.request<UsageQuota>('/api/v1/usage', {
      method: 'GET',
      ...options,
    });
  }
}

// Alias for backwards compatibility
export const MediaClient = MediaPlatformClient;
