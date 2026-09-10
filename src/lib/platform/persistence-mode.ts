import { isSupabaseAdminConfigured } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { AppError } from '@/lib/errors/app-error';
import { ErrorCodes } from '@/lib/errors/codes';

/**
 * Central Persistence and Mock Policy Authority
 * Enforces production invariants: domain writes and persistent operations
 * must NEVER silently fall back to mock memory in production environments.
 */

/**
 * Returns true if real database backend (Supabase PostgreSQL) is configured.
 */
export function isPersistentMode(): boolean {
  return Boolean(isSupabaseAdminConfigured() || isSupabaseConfigured());
}

/**
 * Returns true only if mock fallback is explicitly allowed.
 * Mock fallback is STRICTLY FORBIDDEN in production.
 */
export function isMockModeAllowed(): boolean {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  return !isPersistentMode() || process.env.NODE_ENV === 'test';
}

/**
 * Enforces that a persistent database backend is configured.
 * Throws explicit AppError in production if persistent backend is missing.
 */
export function assertPersistentBackend(serviceName: string): void {
  if (process.env.NODE_ENV === 'production' && !isPersistentMode()) {
    throw AppError.internal(
      `Persistent database backend is required in production environment for ${serviceName}. Silent mock fallback is forbidden.`,
      ErrorCodes.PERSISTENCE_ERROR
    );
  }
}
