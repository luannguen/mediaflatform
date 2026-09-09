import crypto from 'crypto';

const SALT = process.env.API_KEY_SECRET_SALT || 'media_platform_default_salt_2026';

export interface GeneratedApiKey {
  rawKey: string;      // The full key to return ONCE to the user
  keyPrefix: string;   // The prefix stored in DB to index & identify the key
  keyHash: string;     // The SHA-256 salted hash stored in DB
}

/**
 * Generate a new cryptographically secure API key
 * Format: mda_[env]_[prefix_8chars][secret_32chars]
 * Example: mda_live_8f3a9b2c_d84e17...
 */
export function generateApiKey(isProduction: boolean = true): GeneratedApiKey {
  const env = isProduction ? 'live' : 'test';
  const prefixRandom = crypto.randomBytes(4).toString('hex'); // 8 chars
  const secretRandom = crypto.randomBytes(24).toString('hex'); // 48 chars
  
  const keyPrefix = `mda_${env}_${prefixRandom}`;
  const rawKey = `${keyPrefix}_${secretRandom}`;
  const keyHash = hashApiKey(rawKey);

  return {
    rawKey,
    keyPrefix,
    keyHash,
  };
}

/**
 * Compute SHA-256 HMAC or salted hash of the raw API key
 */
export function hashApiKey(rawKey: string): string {
  return crypto
    .createHmac('sha256', SALT)
    .update(rawKey.trim())
    .digest('hex');
}

/**
 * Verify if a raw key matches a stored hash in constant time
 */
export function verifyApiKeyHash(rawKey: string, storedHash: string): boolean {
  const computedHash = hashApiKey(rawKey);
  if (computedHash.length !== storedHash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(computedHash), Buffer.from(storedHash));
}

/**
 * Check if the principal has the required scope
 * Supports wildcard: e.g. "assets:*" grants "assets:read", "assets:write", "assets:delete"
 */
export function hasScope(grantedScopes: string[], requiredScope: string): boolean {
  if (!grantedScopes || grantedScopes.length === 0) return false;
  if (grantedScopes.includes('*') || grantedScopes.includes(requiredScope)) return true;

  const [requiredDomain] = requiredScope.split(':');
  if (grantedScopes.includes(`${requiredDomain}:*`)) return true;

  return false;
}
