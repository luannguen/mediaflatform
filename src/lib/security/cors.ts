import { NextRequest, NextResponse } from 'next/server';

/**
 * Handle CORS headers per application / workspace whitelist
 */
export function getCorsHeaders(req: NextRequest, allowedOrigins: string[] = []): Headers {
  const origin = req.headers.get('origin') || '';
  const headers = new Headers();

  const isLocal = origin.includes('localhost') || origin.includes('127.0.0.1');
  const isAllowed =
    allowedOrigins.includes('*') ||
    allowedOrigins.some((o) => o.trim().toLowerCase() === origin.trim().toLowerCase()) ||
    (isLocal && process.env.NODE_ENV !== 'production');

  if (isAllowed && origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    headers.set(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Media-Api-Key, X-Workspace-Id, Cache-Control'
    );
    headers.set('Access-Control-Max-Age', '86400');
  }

  return headers;
}

/**
 * Preflight OPTIONS request handler
 */
export function handleCorsPreflight(req: NextRequest, allowedOrigins: string[] = []): NextResponse {
  const headers = getCorsHeaders(req, allowedOrigins);
  return new NextResponse(null, {
    status: 204,
    headers,
  });
}
