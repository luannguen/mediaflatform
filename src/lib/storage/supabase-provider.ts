import { StorageProvider, StorageUploadResult, DirectUploadCapability, ObjectMetadata } from './provider';
import { supabaseAdmin, isSupabaseAdminConfigured } from '../supabase/admin';

export function assertStorageKey(key: string) {
  if (!key || key.length > 1024 || /[\\\x00-\x1f]/.test(key) || key.startsWith('/') || key.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Invalid storage key');
  if (!isSupabaseAdminConfigured()) throw new Error('Storage backend is not configured');
}
export class SupabaseStorageProvider implements StorageProvider {
  readonly name = 'supabase';
  constructor(private defaultBucket = process.env.SUPABASE_STORAGE_BUCKET || 'media-assets') {}
  async upload(data: Buffer | Uint8Array | Blob, key: string, mimeType: string, bucket = this.defaultBucket): Promise<StorageUploadResult> {
    assertStorageKey(key);
    const { error } = await supabaseAdmin.storage.from(bucket).upload(key, data, { contentType: mimeType, upsert: true });
    if (error) throw new Error('Storage upload failed: ' + error.name);
    return { storageKey: key, storageUrl: this.getPublicUrl(key, bucket), sizeBytes: data instanceof Blob ? data.size : data.byteLength, mimeType };
  }
  async delete(key: string, bucket = this.defaultBucket): Promise<boolean> {
    assertStorageKey(key);
    const { error } = await supabaseAdmin.storage.from(bucket).remove([key]);
    if (error) throw new Error('Storage deletion failed: ' + error.name);
    return true;
  }
  async getSignedDownloadUrl(key: string, expiresInSeconds = 3600, bucket = this.defaultBucket): Promise<string> {
    assertStorageKey(key);
    const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(key, expiresInSeconds);
    if (error || !data) throw new Error('Storage download capability failed');
    return data.signedUrl;
  }
  getPublicUrl(key: string, bucket = this.defaultBucket): string {
    assertStorageKey(key);
    // Historical metadata only: delivery clients must use the authenticated asset gateway.
    return supabaseAdmin.storage.from(bucket).getPublicUrl(key).data.publicUrl;
  }
  async exists(key: string, bucket = this.defaultBucket): Promise<boolean> { return Boolean(await this.getObjectMetadata(key, bucket)); }
  async download(key: string, bucket = this.defaultBucket): Promise<Buffer | null> {
    assertStorageKey(key);
    const { data, error } = await supabaseAdmin.storage.from(bucket).download(key);
    if (error) {
      if ('statusCode' in error && String(error.statusCode) === '404') return null;
      throw new Error('Storage download failed');
    }
    return data ? Buffer.from(await data.arrayBuffer()) : null;
  }
  async createPresignedUploadUrl(key: string, mimeType: string, _expiresInSeconds = 7200, bucket = this.defaultBucket) {
    assertStorageKey(key);
    const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUploadUrl(key, { upsert: false });
    if (error || !data) throw new Error('Storage upload capability failed');
    return { uploadUrl: data.signedUrl, storageKey: key, token: data.token, method: 'PUT' as const, headers: { 'Content-Type': mimeType }, expiresInSeconds: 7200 };
  }
  async getObjectMetadata(key: string, bucket = this.defaultBucket): Promise<ObjectMetadata | null> {
    assertStorageKey(key);
    const { data, error } = await supabaseAdmin.storage.from(bucket).info(key);
    if (error) {
      if ('statusCode' in error && String(error.statusCode) === '404') return null;
      throw new Error('Storage metadata unavailable');
    }
    return data ? { sizeBytes: Number(data.size), contentType: data.contentType, etag: data.etag, lastModified: data.lastModified ? new Date(data.lastModified) : undefined } : null;
  }
  async createDirectUploadSession(params: {key: string; mimeType: string; sizeBytes?: number; expiresInSeconds?: number; bucket?: string; preferProtocol?: 'signed-put' | 'tus'}): Promise<DirectUploadCapability> {
    const bucket = params.bucket || this.defaultBucket;
    const signed = await this.createPresignedUploadUrl(params.key, params.mimeType, 7200, bucket);
    return { ...signed, protocol: 'signed-put', storageProvider: this.name, storageBucket: bucket, expiresAt: new Date(Date.now() + signed.expiresInSeconds * 1000).toISOString() };
  }
}
