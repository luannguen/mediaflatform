export interface StorageUploadResult {
  storageKey: string;
  storageUrl: string;
  sizeBytes: number;
  mimeType: string;
  checksum?: string;
}

export interface PresignedUploadResult {
  uploadUrl: string;
  storageKey: string;
  method: 'PUT' | 'POST';
  headers?: Record<string, string>;
  token?: string;
  expiresInSeconds: number;
}

export interface StorageProvider {
  readonly name: string;
  upload(
    data: Buffer | Uint8Array | Blob,
    key: string,
    mimeType: string,
    bucket?: string
  ): Promise<StorageUploadResult>;
  delete(key: string, bucket?: string): Promise<boolean>;
  getSignedDownloadUrl(key: string, expiresInSeconds?: number, bucket?: string): Promise<string>;
  getPublicUrl(key: string, bucket?: string): string;
  exists(key: string, bucket?: string): Promise<boolean>;
  createPresignedUploadUrl(
    key: string,
    mimeType: string,
    expiresInSeconds?: number,
    bucket?: string
  ): Promise<PresignedUploadResult>;
}
