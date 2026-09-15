import { NextRequest, NextResponse } from 'next/server';

/**
 * Validate whether a request Origin is explicitly permitted.
 * Strictly forbids reflecting arbitrary/untrusted origins when credentials are enabled.
 */
export function isAllowedOrigin(origin: string, customAllowedOrigins: string[] = []): boolean {
  if (!origin) return false;

  const envOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim().toLowerCase())
    .filter(Boolean);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL
    ? new URL(process.env.NEXT_PUBLIC_APP_URL).origin.toLowerCase()
    : '';

  const allowlist = new Set([
    ...envOrigins,
    ...customAllowedOrigins.map((o) => o.trim().toLowerCase()),
  ]);
  if (appUrl) allowlist.add(appUrl);

  const originLower = origin.trim().toLowerCase();

  if (allowlist.has(originLower)) {
    return true;
  }

  // Development & test environments permit local loopback
  if (process.env.NODE_ENV !== 'production') {
    if (
      originLower.startsWith('http://localhost:') ||
      originLower.startsWith('http://127.0.0.1:') ||
      originLower.startsWith('https://localhost:')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Determine if an API pathname is a public read-only resource
 * Public resources permit wild-card CORS without user credentials.
 */
export function isPublicResource(pathname: string): boolean {
  return (
    (pathname.startsWith('/api/v1/delivery/') && pathname !== '/api/v1/delivery/grants') ||
    pathname === '/api/openapi.json' ||
    pathname === '/api/v1/openapi.json' ||
    pathname === '/api/v1/capabilities' ||
    pathname === '/api/v1/health/live' ||
    pathname === '/api/v1/health/ready' ||
    pathname === '/api/v1/health'
  );
}

/**
 * Handle CORS preflight OPTIONS requests securely
 */
export function handleCorsPreflight(req: NextRequest, customAllowedOrigins: string[] = []): NextResponse {
  const origin = req.headers.get('origin') || '';
  const { pathname } = req.nextUrl;
  const isPublic = isPublicResource(pathname);
  const allowed = isAllowedOrigin(origin, customAllowedOrigins);

  // If public route, permit any origin without credentials
  if (isPublic) {
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers':
          'Content-Type, Authorization, X-Media-Api-Key, X-Request-Id, Cache-Control',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  // Authenticated/Sensitive route: Origin must be verified in allowlist
  if (allowed && origin) {
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
        'Access-Control-Allow-Headers':
          'Content-Type, Authorization, X-Media-Api-Key, X-Workspace-Id, X-Request-Id, Idempotency-Key, Cache-Control',
        'Access-Control-Expose-Headers':
          'X-Request-Id, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      },
    });
  }

  // Unauthorized origin attempting credentialed preflight: Reject with HTTP 403
  return new NextResponse(
    JSON.stringify({
      success: false,
      error: {
        code: 'CORS_ORIGIN_DENIED',
        message: `Cross-Origin request from origin "${origin}" is forbidden.`,
      },
    }),
    {
      status: 403,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
}

/**
 * Apply secure CORS headers to outgoing API responses
 */
export function applyCorsHeaders(res: NextResponse, req: NextRequest, customAllowedOrigins: string[] = []): void {
  const origin = req.headers.get('origin') || '';
  const { pathname } = req.nextUrl;
  const isPublic = isPublicResource(pathname);

  if (isPublic) {
    res.headers.set('Access-Control-Allow-Origin', '*');
  } else if (origin && isAllowedOrigin(origin, customAllowedOrigins)) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Access-Control-Allow-Credentials', 'true');
    res.headers.set('Vary', 'Origin');
  }
}
