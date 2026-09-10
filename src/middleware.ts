import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/lib/auth/session';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1. Allow public static assets and system routes
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname === '/favicon.ico' ||
    pathname === '/icon.svg'
  ) {
    return NextResponse.next();
  }

  // 2. Allow embeddable picker widget & public landing test demo
  if (pathname.startsWith('/picker') || pathname.startsWith('/landingtest')) {
    return NextResponse.next();
  }

  // 3. Allow API routes (they enforce authentication via API Keys or session tokens internally)
  // Also handle CORS preflight OPTIONS requests for cross-origin callers
  if (pathname.startsWith('/api/')) {
    const rawReqId = req.headers.get('x-request-id') || req.headers.get('X-Request-Id');
    const sanitizedReqId = rawReqId
      ? rawReqId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
      : `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    const origin = req.headers.get('origin') || '*';

    if (req.method === 'OPTIONS') {
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
        },
      });
    }

    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-request-id', sanitizedReqId);

    const response = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });

    response.headers.set('X-Request-Id', sanitizedReqId);
    response.headers.set('Access-Control-Expose-Headers', 'X-Request-Id, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After');
    return response;
  }

  // 3. Inspect session cookie for web pages
  const sessionCookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionToken(sessionCookie);

  // 4. Handle Login Page
  if (pathname === '/login') {
    // If already logged in, redirect straight to dashboard
    if (session) {
      const redirectUrl = req.nextUrl.searchParams.get('redirect') || '/';
      return NextResponse.redirect(new URL(redirectUrl, req.url));
    }
    return NextResponse.next();
  }

  // 5. Protected Dashboard Routes: If unauthenticated, redirect to /login
  if (!session) {
    const loginUrl = new URL('/login', req.url);
    if (pathname !== '/') {
      loginUrl.searchParams.set('redirect', pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
