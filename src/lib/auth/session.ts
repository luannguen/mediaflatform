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
const SESSION_SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || 'mda_super_secret_session_key_2026';
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 days

export const DEMO_USERS: Record<string, { email: string; name: string; role: UserRole; description: string }> = {
  admin: {
    email: 'admin@zeroresidues.com',
    name: 'Alex Rivera (Lead Architect)',
    role: 'admin',
    description: 'Toàn quyền quản trị, xóa vĩnh viễn, cấp API Key, quản lý Workspace',
  },
  editor: {
    email: 'editor@zeroresidues.com',
    name: 'Sarah Connor (Content Lead)',
    role: 'editor',
    description: 'Tải lên, biên tập metadata, phân loại thư mục, chuyển vào thùng rác',
  },
  viewer: {
    email: 'viewer@zeroresidues.com',
    name: 'David Lee (Auditor / Guest)',
    role: 'viewer',
    description: 'Chỉ xem và tra cứu tài nguyên, bị khóa tính năng Upload, Delete, API Keys',
  },
  developer: {
    email: 'dev@zeroresidues.com',
    name: 'Evelyn Wang (Integration Dev)',
    role: 'developer',
    description: 'Quản lý Applications, Service Accounts, API Keys và Webhooks',
  },
};

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function stringToBase64Url(str: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'utf8').toString('base64url');
  }
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlToString(b64url: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(b64url, 'base64url').toString('utf8');
  }
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(b64)));
}

async function signHmac(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return bufferToBase64Url(signature);
}

/**
 * Sign a session payload into a tamper-proof token using universal Web Crypto (Edge & Node compatible)
 */
export async function createSessionToken(
  data: Omit<UserSession, 'issuedAt' | 'expiresAt'>
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const session: UserSession = {
    ...data,
    issuedAt: now,
    expiresAt: now + SESSION_MAX_AGE_SEC,
  };

  const payloadB64 = stringToBase64Url(JSON.stringify(session));
  const signature = await signHmac(SESSION_SECRET, payloadB64);

  return `${payloadB64}.${signature}`;
}

/**
 * Verify and decode session token using universal Web Crypto (Edge & Node compatible)
 */
export async function verifySessionToken(token?: string | null): Promise<UserSession | null> {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, signature] = parts;
  const expectedSig = await signHmac(SESSION_SECRET, payloadB64);

  if (signature !== expectedSig) {
    return null;
  }

  try {
    const session: UserSession = JSON.parse(base64UrlToString(payloadB64));
    const now = Math.floor(Date.now() / 1000);
    if (session.expiresAt && session.expiresAt < now) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}
