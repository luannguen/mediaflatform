import crypto from 'crypto';
import { AppError } from '@/lib/errors/app-error';
import { ErrorCodes } from '@/lib/errors/codes';

export interface DeliveryGrantPayload {
  v: 1;
  kid: string;
  gid: string;
  aid: string;
  wid: string;
  perms: string[];
  iat: number;
  exp: number;
}

export interface DeliveryGrantHeader {
  alg: 'HS256';
  typ: 'MDG';
  kid: string;
}

export type DeliveryGrantPermission =
  | 'hls:read'
  | 'poster:read'
  | 'preview:read'
  | 'asset:read'
  | 'video:delivery'
  | string;

export interface MintGrantParams {
  assetId: string;
  workspaceId: string;
  permissions?: string[];
  ttlSeconds?: number;
}

export interface VerifyGrantResult {
  valid: boolean;
  code?: string;
  message?: string;
  payload?: DeliveryGrantPayload;
}

const DEFAULT_TTL_SECONDS = 300; // 5 minutes
const MAX_TTL_SECONDS = 3600; // 1 hour maximum
const MAX_TOKEN_BYTES = 1024; // 1KB limit to prevent DoS

/**
 * Keyring management with key rotation support (kid)
 */
function getKeyring(): { currentKid: string; keys: Record<string, string> } {
  const envKeys = process.env.DELIVERY_GRANT_KEYS;
  if (envKeys) {
    try {
      const parsed = JSON.parse(envKeys);
      if (parsed.current_kid && parsed.keys && typeof parsed.keys === 'object') {
        return {
          currentKid: parsed.current_kid,
          keys: parsed.keys,
        };
      }
    } catch {
      // Non-JSON env fallback
    }
  }

  const singleSecret =
    process.env.DELIVERY_GRANT_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXTAUTH_SECRET;

  if (singleSecret) {
    return {
      currentKid: 'dgk_default',
      keys: {
        dgk_default: singleSecret,
      },
    };
  }

  if (process.env.NODE_ENV === 'production') {
    throw AppError.internal(
      'Delivery grant signing secret is missing in production. Fail-closed policy enforced.',
      'DELIVERY_KEY_MISSING'
    );
  }

  // Local/Dev/Testing fallback only
  return {
    currentKid: 'dgk_dev',
    keys: {
      dgk_dev: 'dev_delivery_grant_secret_key_3.8.4_anticrash',
    },
  };
}

function base64UrlEncode(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Buffer {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64');
}

/**
 * Mint a short-lived cryptographic delivery grant (HMAC-SHA256)
 */
export function mintDeliveryGrant(params: MintGrantParams): {
  grant: string;
  expires_at: string;
  permissions: string[];
} {
  const { currentKid, keys } = getKeyring();
  const secret = keys[currentKid];
  if (!secret) {
    throw AppError.internal(`Signing key [${currentKid}] not found in keyring`, 'DELIVERY_KEY_MISSING');
  }

  const now = Math.floor(Date.now() / 1000);
  const configuredTtl = parseInt(process.env.MEDIA_DELIVERY_GRANT_TTL_SECONDS || '', 10);
  const ttl = Math.min(
    MAX_TTL_SECONDS,
    Math.max(30, params.ttlSeconds || configuredTtl || DEFAULT_TTL_SECONDS)
  );
  const exp = now + ttl;

  const header: DeliveryGrantHeader = {
    alg: 'HS256',
    typ: 'MDG',
    kid: currentKid,
  };

  const grantId = `grnt_${now.toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
  const perms = params.permissions && params.permissions.length > 0 ? params.permissions : ['video:delivery'];

  const payload: DeliveryGrantPayload = {
    v: 1,
    kid: currentKid,
    gid: grantId,
    aid: params.assetId,
    wid: params.workspaceId,
    perms,
    iat: now,
    exp,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto.createHmac('sha256', secret).update(signingInput).digest();
  const encodedSignature = base64UrlEncode(signature);

  const grant = `mdg_v1_${signingInput}.${encodedSignature}`;

  return {
    grant,
    expires_at: new Date(exp * 1000).toISOString(),
    permissions: perms,
  };
}

/**
 * Verify delivery grant token with constant-time HMAC comparison and strict scope validation
 */
export function verifyDeliveryGrant(
  token: string,
  expectedAssetId: string,
  expectedWorkspaceId: string,
  requiredPermission: string
): VerifyGrantResult {
  if (!token || typeof token !== 'string') {
    return { valid: false, code: 'DELIVERY_GRANT_INVALID', message: 'Missing delivery grant token' };
  }

  if (Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES) {
    return { valid: false, code: 'DELIVERY_GRANT_INVALID', message: 'Delivery grant exceeds maximum size' };
  }

  if (!token.startsWith('mdg_v1_')) {
    return { valid: false, code: 'DELIVERY_GRANT_INVALID', message: 'Unsupported grant version prefix' };
  }

  const rawParts = token.slice('mdg_v1_'.length).split('.');
  if (rawParts.length !== 3) {
    return { valid: false, code: 'DELIVERY_GRANT_INVALID', message: 'Malformed grant token structure' };
  }

  const [encodedHeader, encodedPayload, encodedSignature] = rawParts;

  let header: DeliveryGrantHeader;
  let payload: DeliveryGrantPayload;

  try {
    header = JSON.parse(base64UrlDecode(encodedHeader).toString('utf8'));
    payload = JSON.parse(base64UrlDecode(encodedPayload).toString('utf8'));
  } catch {
    return { valid: false, code: 'DELIVERY_GRANT_INVALID', message: 'Failed to decode grant payload' };
  }

  if (header.alg !== 'HS256' || header.typ !== 'MDG') {
    return { valid: false, code: 'DELIVERY_GRANT_INVALID', message: 'Invalid grant algorithm or token type' };
  }

  const { keys } = getKeyring();
  const secret = keys[header.kid];
  if (!secret) {
    return { valid: false, code: 'DELIVERY_GRANT_KEY_UNKNOWN', message: `Unknown signing key [${header.kid}]` };
  }

  // Constant-time HMAC signature verification
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSig = crypto.createHmac('sha256', secret).update(signingInput).digest();
  let receivedSig: Buffer;
  try {
    receivedSig = base64UrlDecode(encodedSignature);
  } catch {
    return { valid: false, code: 'DELIVERY_GRANT_INVALID', message: 'Invalid signature encoding' };
  }

  if (receivedSig.length !== expectedSig.length || !crypto.timingSafeEqual(receivedSig, expectedSig)) {
    return { valid: false, code: 'DELIVERY_GRANT_TAMPERED', message: 'Cryptographic signature verification failed' };
  }

  // Time & Lifespan checks
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= payload.iat || payload.exp - payload.iat > MAX_TTL_SECONDS) {
    return { valid: false, code: 'DELIVERY_GRANT_INVALID', message: 'Grant lifespan is out of allowable boundaries' };
  }

  if (now > payload.exp) {
    return { valid: false, code: 'DELIVERY_GRANT_EXPIRED', message: 'Delivery grant has expired' };
  }

  // Cross-tenant & Cross-asset containment
  if (payload.aid !== expectedAssetId) {
    return {
      valid: false,
      code: 'DELIVERY_GRANT_ASSET_MISMATCH',
      message: `Grant was issued for asset [${payload.aid}], not [${expectedAssetId}]`,
    };
  }

  if (payload.wid !== expectedWorkspaceId) {
    return {
      valid: false,
      code: 'DELIVERY_GRANT_WORKSPACE_MISMATCH',
      message: 'Grant was issued for another workspace',
    };
  }

  // Permission scope check
  const allowed =
    payload.perms.includes(requiredPermission) ||
    payload.perms.includes('video:delivery') ||
    payload.perms.includes('*');

  if (!allowed) {
    return {
      valid: false,
      code: 'DELIVERY_GRANT_INSUFFICIENT_PERMISSIONS',
      message: `Grant lacks required permission [${requiredPermission}]`,
    };
  }

  return {
    valid: true,
    payload,
  };
}

/**
 * Safely append a delivery grant token to an HLS URI preserving existing queries and comments
 */
export function appendDeliveryGrant(uri: string, grant: string): string {
  const trimmed = uri.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return uri; // Preserve metadata and comments
  }

  const encodedGrant = encodeURIComponent(grant);
  if (trimmed.includes('?')) {
    const [base, query] = trimmed.split('?');
    const params = new URLSearchParams(query);
    params.set('grant', grant);
    return `${base}?${params.toString()}`;
  }

  return `${trimmed}?grant=${encodedGrant}`;
}
