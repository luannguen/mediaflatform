import crypto from 'crypto';

export type IdPrefix =
  | 'med'
  | 'fld'
  | 'col'
  | 'tag'
  | 'app'
  | 'svc'
  | 'key'
  | 'ref'
  | 'upl'
  | 'job'
  | 'req'
  | 'evt'
  | 'ws'
  | 'org'
  | 'wh'
  | 'whd'
  | 'usr'
  | 'rol'
  | 'mem'
  | 'inv'
  | 'ver'
  | 'met'
  | 'run';

/**
 * Generate a cryptographically secure human/debug-friendly prefixed identifier
 * Format: [prefix]_[timestamp_base36][random_hex_12]
 * Example: med_1j7a8b9c0d1e2f
 */
export function generateId(prefix: IdPrefix): string {
  const timestamp = Date.now().toString(36);
  const randomBytes = crypto.randomBytes(6).toString('hex');
  return `${prefix}_${timestamp}${randomBytes}`;
}

/**
 * Validate if an ID matches expected prefix
 */
export function isValidId(id: string, expectedPrefix?: IdPrefix): boolean {
  if (!id || typeof id !== 'string') return false;
  if (expectedPrefix) {
    return id.startsWith(`${expectedPrefix}_`);
  }
  return /^[a-z]{2,4}_[a-z0-9]+$/.test(id);
}
