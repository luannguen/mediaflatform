import { StorageProvider } from './provider';
import { SupabaseStorageProvider } from './supabase-provider';

let storageInstance: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (!storageInstance) {
    const providerType = process.env.STORAGE_PROVIDER || 'supabase';
    switch (providerType) {
      case 'supabase':
      default:
        storageInstance = new SupabaseStorageProvider();
        break;
    }
  }
  return storageInstance;
}
