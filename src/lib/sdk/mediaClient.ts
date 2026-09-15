/**
 * Media Platform Client SDK
 * Lightweight, zero-dependency universal SDK for external projects (Node.js, Browser, React, Vue, Mobile).
 */

export interface MediaClientConfig {
  apiKey: string;
  baseUrl?: string;
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
  mimeType?: string;
  sizeBytes?: number;
  folderId?: string | null;
  visibility?: 'private' | 'workspace' | 'public';
  expiresIn?: number;
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

export interface ReferenceInput {
  assetId: string;
  sourceApp: string;
  entityType: string;
  entityId: string;
  fieldName?: string;
  context?: Record<string, any>;
}

export interface ReplaceAssetOptions {
  file?: File | Blob;
  storageKey?: string;
  storageUrl?: string;
  mimeType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  comment?: string;
}

export class MediaClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: MediaClientConfig) {
    if (!config.apiKey) {
      throw new Error('MediaClient: apiKey is required.');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || 'http://localhost:3000').replace(/\/$/, '');
  }

  private async request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = new Headers(options.headers || {});
    headers.set('X-Media-Api-Key', this.apiKey);
    headers.set('X-Media-Api-Version', '2026-09-01');

    if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    const json = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMsg = json.error?.message || `HTTP ${response.status}: Request failed`;
      const err: any = new Error(errorMsg);
      err.code = json.error?.code || 'REQUEST_FAILED';
      err.status = response.status;
      throw err;
    }

    return json.data !== undefined ? json.data : json;
  }

  /**
   * Upload media (v3.8.4 Direct Upload Session flow)
   * Direct-to-storage upload bypassing serverless function payload limits
   */
  async upload(file: File | Blob, options: UploadOptions = {}): Promise<any> {
    const filename = (file as File).name || 'upload.bin';
    const mimeType = file.type || 'application/octet-stream';
    const sizeBytes = file.size;

    // 1. Create upload session
    const sessionRes = await this.request('/api/v1/uploads/sessions', {
      method: 'POST',
      body: JSON.stringify({
        filename,
        file_size: sizeBytes,
        mime_type: mimeType,
        display_name: options.displayName || filename,
        folder_id: options.folderId || null,
        visibility: options.visibility || 'workspace',
        metadata: options.metadata || {},
      }),
    });

    const capability = sessionRes.capability;
    const session = sessionRes.session;

    if (capability?.uploadUrl) {
      const uploadHeaders: Record<string, string> = {
        'Content-Type': mimeType,
        ...(capability.headers || {}),
      };

      const directRes = await fetch(capability.uploadUrl, {
        method: capability.method || 'PUT',
        headers: uploadHeaders,
        body: file,
      });

      if (!directRes.ok && directRes.status !== 200 && directRes.status !== 201) {
        throw new Error(`Direct upload failed with status ${directRes.status}`);
      }
    }

    // 2. Finalize session atomically via PostgreSQL RPC
    const completeRes = await this.request(`/api/v1/uploads/sessions/${session.id}/complete`, {
      method: 'POST',
    });

    return completeRes.asset || completeRes;
  }

  /**
   * Mint short-lived delivery grant for private asset delivery
   */
  async getDeliveryGrant(assetId: string): Promise<{
    delivery_grant: string | null;
    expires_in_seconds: number;
    expires_at: string;
    urls: {
      master_playlist: string;
      poster: string;
      preview: string;
    };
  }> {
    return this.request(`/api/v1/assets/${assetId}/delivery-grant`, {
      method: 'GET',
    });
  }

  /**
   * Trụ Cột 1: Direct-to-Storage Presigned Upload
   * Generate a signed upload URL to upload directly to S3 / Supabase Storage
   */
  async createPresignedUpload(options: PresignedUploadOptions): Promise<{
    asset_id: string;
    upload_url: string;
    storage_key: string;
    storage_url: string;
    method: 'PUT' | 'POST';
    headers?: Record<string, string>;
    expires_in: number;
  }> {
    return this.request('/api/v1/uploads/presigned', {
      method: 'POST',
      body: JSON.stringify({
        filename: options.filename,
        mime_type: options.mimeType || 'application/octet-stream',
        size_bytes: options.sizeBytes || 0,
        folder_id: options.folderId || null,
        visibility: options.visibility || 'workspace',
        expires_in: options.expiresIn || 900,
      }),
    });
  }

  /**
   * Trụ Cột 1: Confirm Presigned Upload
   * Called after direct upload completes to activate asset, trigger palette extraction & webhooks
   */
  async confirmUpload(
    assetId: string,
    metadata?: {
      width?: number;
      height?: number;
      size_bytes?: number;
      checksum?: string;
    }
  ): Promise<any> {
    return this.request('/api/v1/uploads/confirm', {
      method: 'POST',
      body: JSON.stringify({
        asset_id: assetId,
        ...(metadata || {}),
      }),
    });
  }

  /**
   * Trụ Cột 1: Full Direct-to-Storage Upload Pipeline
   * 1. Generates presigned URL
   * 2. PUTs file straight to storage
   * 3. Confirms and returns active asset
   */
  async uploadDirect(file: File | Blob, options: UploadOptions = {}): Promise<any> {
    const filename = (file as File).name || 'direct_upload.bin';
    const mimeType = file.type || 'application/octet-stream';
    const sizeBytes = file.size;

    const presigned = await this.createPresignedUpload({
      filename,
      mimeType,
      sizeBytes,
      folderId: options.folderId,
      visibility: options.visibility,
    });

    const headers: Record<string, string> = {
      'Content-Type': mimeType,
      ...(presigned.headers || {}),
    };

    const uploadRes = await fetch(presigned.upload_url, {
      method: presigned.method || 'PUT',
      headers,
      body: file,
    });

    if (!uploadRes.ok) {
      throw new Error(`Direct storage upload failed: HTTP ${uploadRes.status}`);
    }

    const confirmed = await this.confirmUpload(presigned.asset_id, {
      size_bytes: sizeBytes,
    });

    return confirmed.asset || confirmed;
  }

  /**
   * Trụ Cột 2: In-Place Asset Versioning
   * Replace asset contents with a new version while keeping the exact same med_... asset ID
   */
  async replaceAsset(assetId: string, options: ReplaceAssetOptions): Promise<{
    asset: any;
    archivedVersion: any;
    versionNumber: number;
  }> {
    return this.request(`/api/v1/assets/${assetId}/versions`, {
      method: 'POST',
      body: JSON.stringify({
        storage_key: options.storageKey,
        storage_url: options.storageUrl,
        mime_type: options.mimeType,
        size_bytes: options.sizeBytes,
        width: options.width,
        height: options.height,
        comment: options.comment,
      }),
    });
  }

  /**
   * Trụ Cột 2: List Version History
   */
  async listVersions(assetId: string): Promise<any[]> {
    return this.request(`/api/v1/assets/${assetId}/versions`);
  }

  /**
   * Trụ Cột 2: Rollback to Past Version
   */
  async rollbackVersion(assetId: string, versionNumber: number): Promise<{ message: string; asset: any }> {
    return this.request(`/api/v1/assets/${assetId}/rollback`, {
      method: 'POST',
      body: JSON.stringify({
        version_number: versionNumber,
      }),
    });
  }

  /**
   * Fetch asset details by ID
   */
  async getAsset(assetId: string): Promise<any> {
    return this.request(`/api/v1/assets/${assetId}`);
  }

  /**
   * List assets with filtering, offset/cursor pagination, or unlimited
   */
  async listAssets(params: {
    folderId?: string;
    type?: string;
    status?: string;
    search?: string;
    page?: number;
    limit?: number | 'all';
    cursor?: string;
    fields?: string[];
    sort?: 'newest' | 'oldest' | 'name' | 'size';
  } = {}): Promise<any> {
    const query = new URLSearchParams();
    if (params.folderId) query.set('folder_id', params.folderId);
    if (params.type) query.set('type', params.type);
    if (params.status) query.set('status', params.status);
    if (params.search) query.set('search', params.search);
    if (params.page) query.set('page', params.page.toString());
    if (params.limit) query.set('limit', params.limit.toString());
    if (params.cursor) query.set('cursor', params.cursor);
    if (params.fields && params.fields.length > 0) query.set('fields', params.fields.join(','));
    if (params.sort) query.set('sort', params.sort);

    return this.request(`/api/v1/assets?${query.toString()}`);
  }

  /**
   * Transparent Auto-Pagination: Fetch all assets without manual loop handling
   */
  async listAllAssets(params: {
    folderId?: string;
    type?: string;
    status?: string;
    search?: string;
    fields?: string[];
    pageSize?: number;
  } = {}): Promise<any[]> {
    const pageSize = Math.min(100, params.pageSize || 100);
    const allItems: any[] = [];
    let currentCursor: string | undefined = undefined;
    let hasMore = true;

    while (hasMore) {
      const response = await this.listAssets({
        folderId: params.folderId,
        type: params.type,
        status: params.status,
        search: params.search,
        fields: params.fields,
        limit: pageSize,
        cursor: currentCursor,
      });

      const items = response.items || response.data || [];
      allItems.push(...items);

      if (response.pagination?.next_cursor) {
        currentCursor = response.pagination.next_cursor;
        hasMore = response.pagination.has_more !== false;
      } else {
        hasMore = false;
      }
    }

    return allItems;
  }

  /**
   * Trụ Cột 3: Sharp CDN Delivery URL with Smart Crop and Dynamic Watermarking
   */
  getSmartDeliveryUrl(
    assetId: string,
    options: {
      width?: number;
      height?: number;
      format?: 'webp' | 'png' | 'jpeg' | 'avif';
      quality?: number;
      smartCrop?: boolean;
      watermark?: string;
      watermarkPos?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'center';
      watermarkOpacity?: number;
    } = {}
  ): string {
    const query = new URLSearchParams();
    if (options.width) query.set('w', options.width.toString());
    if (options.height) query.set('h', options.height.toString());
    if (options.format) query.set('format', options.format);
    if (options.quality) query.set('q', options.quality.toString());

    if (options.smartCrop) {
      query.set('fit', 'smart');
    }

    if (options.watermark) {
      query.set('watermark', options.watermark);
      if (options.watermarkPos) query.set('watermark_pos', options.watermarkPos);
      if (options.watermarkOpacity !== undefined) query.set('watermark_opacity', options.watermarkOpacity.toString());
    }

    const queryString = query.toString();
    return `${this.baseUrl}/api/v1/delivery/${assetId}${queryString ? `?${queryString}` : ''}`;
  }

  /**
   * Standard Delivery URL builder
   */
  getDeliveryUrl(assetId: string, options: TransformOptions = {}): string {
    const query = new URLSearchParams();
    if (options.width) query.set('w', options.width.toString());
    if (options.height) query.set('h', options.height.toString());
    if (options.format) query.set('format', options.format);
    if (options.quality) query.set('q', options.quality.toString());
    if (options.fit) query.set('fit', options.fit);
    if (options.watermark) query.set('watermark', options.watermark);
    if (options.watermarkPos) query.set('watermark_pos', options.watermarkPos);
    if (options.watermarkOpacity !== undefined) query.set('watermark_opacity', options.watermarkOpacity.toString());

    const queryString = query.toString();
    return `${this.baseUrl}/api/v1/delivery/${assetId}${queryString ? `?${queryString}` : ''}`;
  }

  /**
   * Trụ Cột 4: Generate high-performance responsive picture sourceset structures for HTML / React
   */
  getResponsivePictureSet(
    assetId: string,
    options: {
      widths?: number[];
      formats?: ('webp' | 'avif' | 'jpeg')[];
      quality?: number;
      fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside' | 'smart';
      watermark?: string;
    } = {}
  ): {
    defaultUrl: string;
    sources: { type: string; srcset: string }[];
    html: string;
  } {
    const widths = options.widths || [320, 640, 960, 1200, 1920];
    const formats = options.formats || ['avif', 'webp', 'jpeg'];
    const quality = options.quality || 80;
    const fit = options.fit || 'cover';

    const sources = formats.map((fmt) => {
      const srcset = widths
        .map((w) => `${this.getDeliveryUrl(assetId, { width: w, format: fmt, quality, fit, watermark: options.watermark })} ${w}w`)
        .join(', ');
      return {
        type: `image/${fmt}`,
        srcset,
      };
    });

    const defaultUrl = this.getDeliveryUrl(assetId, {
      width: widths[widths.length - 1],
      format: 'webp',
      quality,
      fit,
      watermark: options.watermark,
    });

    const html = `<picture>\n${sources
      .map((s) => `  <source type="${s.type}" srcset="${s.srcset}">`)
      .join('\n')}\n  <img src="${defaultUrl}" loading="lazy" decoding="async" alt="" />\n</picture>`;

    return {
      defaultUrl,
      sources,
      html,
    };
  }

  /**
   * Trụ Cột 5: Analytics & Observability
   */
  async getAnalytics(period: '24h' | '7d' | '30d' = '24h'): Promise<any> {
    return this.request(`/api/v1/analytics?period=${period}`);
  }

  /**
   * Safe Delete: Register an external usage reference to protect the asset from deletion
   */
  async attachReference(input: ReferenceInput): Promise<any> {
    return this.request('/api/v1/references', {
      method: 'POST',
      body: JSON.stringify({
        asset_id: input.assetId,
        source_app: input.sourceApp,
        entity_type: input.entityType,
        entity_id: input.entityId,
        field_name: input.fieldName,
        context: input.context,
      }),
    });
  }

  /**
   * Safe Delete: Detach a reference when an external entity is deleted or replaces its media
   */
  async detachReference(referenceId: string): Promise<boolean> {
    await this.request(`/api/v1/references?id=${encodeURIComponent(referenceId)}`, {
      method: 'DELETE',
    });
    return true;
  }

  /**
   * Delete or move an asset to trash
   */
  async deleteAsset(assetId: string, permanent: boolean = false): Promise<boolean> {
    await this.request(`/api/v1/assets/${assetId}${permanent ? '?permanent=true' : ''}`, {
      method: 'DELETE',
    });
    return true;
  }

  /**
   * Helper to open the Embeddable Media Picker in a popup window
   */
  openPicker(options: {
    onSelect: (asset: any) => void;
    multiple?: boolean;
    types?: string[];
    title?: string;
  }): Window | null {
    if (typeof window === 'undefined') return null;

    const query = new URLSearchParams();
    query.set('api_key', this.apiKey);
    if (options.multiple) query.set('mode', 'multiple');
    if (options.types && options.types.length > 0) query.set('types', options.types.join(','));

    const pickerUrl = `${this.baseUrl}/picker?${query.toString()}`;
    const width = 1000;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const popup = window.open(
      pickerUrl,
      options.title || 'MediaPicker',
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=yes`
    );

    const messageHandler = (event: MessageEvent) => {
      if (event.data && event.data.type === 'MEDIA_ASSET_SELECTED') {
        options.onSelect(event.data.asset);
        window.removeEventListener('message', messageHandler);
        if (popup && !popup.closed) popup.close();
      }
    };

    window.addEventListener('message', messageHandler);
    return popup;
  }

  /**
   * Helper to verify HMAC-SHA256 signatures of outbound webhooks
   */
  static verifyWebhookSignature(payloadString: string, signature: string, secret: string): boolean {
    try {
      if (typeof process !== 'undefined' && process.versions && process.versions.node) {
        const crypto = require('crypto');
        const expected = crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
        if (signature.length !== expected.length) return false;
        return crypto.timingSafeEqual(Buffer.from(signature, 'utf-8'), Buffer.from(expected, 'utf-8'));
      }
      return false;
    } catch {
      return false;
    }
  }
}
