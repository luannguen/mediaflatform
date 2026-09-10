import { NextRequest } from 'next/server';
import crypto from 'crypto';

/**
 * Centralized Request Context & Redaction Service
 * Propagates deterministic/sanitized correlation IDs and purges sensitive credentials from logs.
 */

const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-media-api-key',
  'api_key',
  'apikey',
  'rawkey',
  'key_hash',
  'secret',
  'secret_hash',
  'password',
  'worker_token',
  'token',
  'access_token',
  'refresh_token',
  'private_key',
]);

export function generateRequestId(): string {
  const rand = crypto.randomBytes(4).toString('hex');
  return `req_${Date.now().toString(36)}_${rand}`;
}

export function extractRequestId(req?: NextRequest | Headers | null): string {
  if (!req) return generateRequestId();

  let headerVal: string | null = null;
  if ('headers' in req && typeof req.headers?.get === 'function') {
    headerVal = req.headers.get('x-request-id') || req.headers.get('X-Request-Id');
  } else if (typeof (req as any).get === 'function') {
    headerVal = (req as Headers).get('x-request-id') || (req as Headers).get('X-Request-Id');
  }

  if (headerVal && typeof headerVal === 'string') {
    // Sanitize: allow alphanumeric, underscore, hyphen, max 64 chars
    const cleaned = headerVal.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    if (cleaned.length >= 4) {
      return cleaned;
    }
  }

  return generateRequestId();
}

/**
 * Deep redaction of sensitive credentials, keys, passwords, and tokens.
 */
export function redactSensitiveData(data: any): any {
  if (data === null || data === undefined) return data;
  if (typeof data === 'string') {
    // Redact Bearer tokens or mda_ keys if in raw string
    if (data.startsWith('Bearer ') || data.startsWith('mda_') || data.startsWith('whsec_')) {
      return '[REDACTED_SECRET]';
    }
    return data;
  }
  if (typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map((item) => redactSensitiveData(item));
  }

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey) || lowerKey.includes('secret') || lowerKey.includes('password')) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = redactSensitiveData(value);
    }
  }
  return result;
}
