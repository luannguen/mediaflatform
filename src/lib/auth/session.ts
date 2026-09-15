export type UserRole = 'owner' | 'admin' | 'media_manager' | 'editor' | 'uploader' | 'viewer' | 'developer';

export interface UserSession {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  workspaceId: string;
  organizationId: string;
  issuedAt: number;
  expiresAt: number;
}

export const SESSION_COOKIE_NAME = 'mda_session';
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7;

function getSessionSecret(): string {
  const secret =
    process.env.SESSION_SECRET ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Session signing secret is required in production');
  }
  return 'dev_only_media_platform_session_secret';
}

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64url');
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function stringToBase64Url(str: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf8').toString('base64url');
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlToString(b64url: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(b64url, 'base64url').toString('utf8');
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(b64)));
}

function base64UrlToBytes(b64url: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64url, 'base64url'));
  let base64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function importHmacKey(secret: string, usages: KeyUsage[]) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages
  );
}

async function signHmac(secret: string, data: string): Promise<string> {
  const key = await importHmacKey(secret, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return bufferToBase64Url(signature);
}

async function verifyHmac(secret: string, data: string, signature: string): Promise<boolean> {
  try {
    const key = await importHmacKey(secret, ['verify']);
    const signatureBuffer = bytesToArrayBuffer(base64UrlToBytes(signature));
    const dataBuffer = bytesToArrayBuffer(new TextEncoder().encode(data));
    return crypto.subtle.verify('HMAC', key, signatureBuffer, dataBuffer);
  } catch {
    return false;
  }
}

/**
 * Sign a session payload into a tamper-proof token using universal Web Crypto.
 * Optional maxAgeSeconds allows short-lived demo/browser sessions without weakening normal sessions.
 */
export async function createSessionToken(
  data: Omit<UserSession, 'issuedAt' | 'expiresAt'>,
  maxAgeSeconds: number = SESSION_MAX_AGE_SEC
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.max(60, Math.min(maxAgeSeconds, SESSION_MAX_AGE_SEC));
  const session: UserSession = {
    ...data,
    issuedAt: now,
    expiresAt: now + ttl,
  };

  const payloadB64 = stringToBase64Url(JSON.stringify(session));
  const signature = await signHmac(getSessionSecret(), payloadB64);
  return `${payloadB64}.${signature}`;
}

export async function verifySessionToken(token?: string | null): Promise<UserSession | null> {
  if (!token || typeof token !== 'string' || token.length > 8192) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;

  if (!(await verifyHmac(getSessionSecret(), payloadB64, signature))) return null;

  try {
    const session: UserSession = JSON.parse(base64UrlToString(payloadB64));
    const now = Math.floor(Date.now() / 1000);
    if (!session.userId || !session.workspaceId || !session.expiresAt) return null;
    if (session.expiresAt <= now || session.expiresAt <= session.issuedAt) return null;
    if (session.expiresAt - session.issuedAt > SESSION_MAX_AGE_SEC) return null;
    return session;
  } catch {
    return null;
  }
}
