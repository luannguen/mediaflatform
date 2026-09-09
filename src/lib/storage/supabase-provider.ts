import { StorageProvider, StorageUploadResult } from './provider';
import { supabaseAdmin, isSupabaseAdminConfigured } from '../supabase/admin';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export class SupabaseStorageProvider implements StorageProvider {
  public readonly name = 'supabase';
  private defaultBucket: string;

  constructor(defaultBucket: string = process.env.SUPABASE_STORAGE_BUCKET || 'media-assets') {
    this.defaultBucket = defaultBucket;
  }

  private saveToLocalCache(key: string, data: Buffer | Uint8Array | Blob, bucket: string) {
    try {
      const localDir = path.join(process.cwd(), 'scratch', 'storage', bucket, path.dirname(key));
      if (!fs.existsSync(localDir)) {
        fs.mkdirSync(localDir, { recursive: true });
      }
      const localFile = path.join(process.cwd(), 'scratch', 'storage', bucket, key);
      if (data instanceof Buffer) {
        fs.writeFileSync(localFile, data);
      } else if (data instanceof Uint8Array) {
        fs.writeFileSync(localFile, Buffer.from(data));
      }
    } catch {
      // Non-blocking local cache write
    }
  }

  async upload(
    data: Buffer | Uint8Array | Blob,
    key: string,
    mimeType: string,
    bucket: string = this.defaultBucket
  ): Promise<StorageUploadResult> {
    const sizeBytes = data instanceof Blob ? data.size : data.byteLength;
    this.saveToLocalCache(key, data, bucket);

    if (!isSupabaseAdminConfigured()) {
      // Mock / Dev fallback: generate data URI so images can render and transform locally
      let mockUrl = `https://mock-storage.media-platform.local/${bucket}/${key}`;
      if (data instanceof Buffer) {
        mockUrl = `data:${mimeType};base64,${data.toString('base64')}`;
      } else if (data instanceof Uint8Array) {
        mockUrl = `data:${mimeType};base64,${Buffer.from(data).toString('base64')}`;
      }
      return {
        storageKey: key,
        storageUrl: mockUrl,
        sizeBytes,
        mimeType,
      };
    }

    const { error } = await supabaseAdmin.storage.from(bucket).upload(key, data, {
      contentType: mimeType,
      upsert: true,
    });

    if (error) {
      throw new Error(`Failed to upload to Supabase Storage: ${error.message}`);
    }

    const storageUrl = this.getPublicUrl(key, bucket);

    return {
      storageKey: key,
      storageUrl,
      sizeBytes,
      mimeType,
    };
  }

  async delete(key: string, bucket: string = this.defaultBucket): Promise<boolean> {
    if (!isSupabaseAdminConfigured()) return true;

    const { error } = await supabaseAdmin.storage.from(bucket).remove([key]);
    if (error) {
      console.warn(`[Storage] Failed to delete object ${key}:`, error.message);
      return false;
    }
    return true;
  }

  async getSignedDownloadUrl(
    key: string,
    expiresInSeconds: number = 3600,
    bucket: string = this.defaultBucket
  ): Promise<string> {
    if (!isSupabaseAdminConfigured()) {
      return `https://mock-storage.media-platform.local/${bucket}/${key}?signed=true&expires=${expiresInSeconds}`;
    }

    const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(key, expiresInSeconds);
    if (error || !data) {
      throw new Error(`Failed to get signed URL: ${error?.message}`);
    }
    return data.signedUrl;
  }

  getPublicUrl(key: string, bucket: string = this.defaultBucket): string {
    if (!isSupabaseAdminConfigured()) {
      return `https://mock-storage.media-platform.local/${bucket}/${key}`;
    }
    const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(key);
    return data.publicUrl;
  }

  async exists(key: string, bucket: string = this.defaultBucket): Promise<boolean> {
    if (!isSupabaseAdminConfigured()) return true;

    const { data, error } = await supabaseAdmin.storage.from(bucket).list('', {
      search: key,
    });
    if (error || !data) return false;
    return data.some((item) => item.name === key);
  }

  async download(key: string, bucket: string = this.defaultBucket): Promise<Buffer | null> {
    if (isSupabaseAdminConfigured()) {
      try {
        const { data, error } = await supabaseAdmin.storage.from(bucket).download(key);
        if (!error && data) {
          const arrayBuffer = await data.arrayBuffer();
          return Buffer.from(arrayBuffer);
        }
      } catch (err: any) {
        console.warn(`[Storage] Supabase download error for ${key}:`, err.message);
      }
    }

    // Fallback to local cache if Supabase is offline or not configured
    try {
      const localFile = path.join(process.cwd(), 'scratch', 'storage', bucket, key);
      if (fs.existsSync(localFile)) {
        return fs.readFileSync(localFile);
      }
    } catch {}

    return null;
  }

  async createPresignedUploadUrl(
    key: string,
    mimeType: string,
    expiresInSeconds: number = 900,
    bucket: string = this.defaultBucket
  ) {
    if (!isSupabaseAdminConfigured()) {
      return {
        uploadUrl: `http://localhost:3000/api/v1/uploads/direct-mock?key=${encodeURIComponent(key)}`,
        storageKey: key,
        method: 'PUT' as const,
        expiresInSeconds,
      };
    }

    const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUploadUrl(key);
    if (error || !data) {
      throw new Error(`Failed to create presigned upload URL: ${error?.message}`);
    }

    return {
      uploadUrl: data.signedUrl,
      storageKey: key,
      token: data.token,
      method: 'PUT' as const,
      headers: {
        'Content-Type': mimeType,
      },
      expiresInSeconds,
    };
  }
}
