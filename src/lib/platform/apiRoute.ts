import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { isAllowedOrigin } from '@/lib/security/cors';
import { rateLimiter } from '@/lib/security/rateLimiter';
import { idempotencyService } from '@/lib/security/idempotency';
import { supabaseAdmin, isSupabaseAdminConfigured } from '@/lib/supabase/admin';
import { AppError } from '@/lib/errors/app-error';
import { errorResponse } from '@/lib/errors/response';
import { extractRequestId } from './requestContext';
import { requestState } from './requestState';

const publicPaths = new Set(['/api/openapi.json','/api/v1/openapi.json','/api/v1/capabilities','/api/v1/health','/api/v1/health/live','/api/v1/health/ready']);
const identityPaths = new Set(['/api/v1/auth/login','/api/v1/auth/register','/api/v1/auth/logout','/api/v1/auth/me','/api/v1/demo/session']);

async function readPayload(req: NextRequest): Promise<unknown> {
  const limit = req.headers.get('content-type')?.includes('multipart/form-data') ? 5 * 1024 * 1024 : 1024 * 1024;
  if (Number(req.headers.get('content-length') || 0) > limit) throw new AppError('Request body too large', 'VALIDATION_ERROR', 413);
  const reader = req.clone().body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { void reader.cancel(); throw new AppError('Request body too large', 'VALIDATION_ERROR', 413); }
    chunks.push(value);
  }
  const buffer = Buffer.concat(chunks);
  if (req.headers.get('content-type')?.includes('application/json')) {
    try { return buffer.length ? JSON.parse(buffer.toString('utf8')) : null; }
    catch { throw AppError.badRequest('Invalid JSON request body'); }
  }
  return buffer;
}

/** All routes share auth-aware throttling, request IDs and durable mutation replays. */
export function withApiRoute<C = any>(handler: (req: NextRequest, context: C) => Promise<Response>, requiredScope?: string) {
  return async (req: NextRequest, context: C): Promise<Response> => {
    if (requestState.getStore()) return handler(req, context as C); // Canonical route aliases.
    const requestId = extractRequestId(req);
    return requestState.run({ requestId }, async () => {
      const start = Date.now();
      const pathname = req.nextUrl.pathname;
      const mutation = !['GET','HEAD','OPTIONS'].includes(req.method);
      const headers: Record<string,string> = { 'X-Request-Id': requestId };
      let response: Response;
      let timer: ReturnType<typeof setInterval> | undefined;
      try {
        const origin = req.headers.get('origin');
        if (mutation && origin && !isAllowedOrigin(origin, [req.nextUrl.origin])) throw AppError.forbidden('Request origin is not allowed');
        if (mutation && req.cookies.has(SESSION_COOKIE_NAME) && req.headers.get('sec-fetch-site') === 'cross-site' && !origin) throw AppError.forbidden('Cross-site mutation is not allowed');
        const exempt = publicPaths.has(pathname);
        if (!exempt) {
          const routeClass = pathname.startsWith('/api/v1/auth/') ? 'admin' : rateLimiter.classifyRoute(req.method, pathname);
          const ipHash = crypto.createHash('sha256').update(req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local').digest('hex');
          const limit = await rateLimiter.checkRateLimit('ip:' + ipHash, routeClass);
          Object.assign(headers, rateLimiter.getHeaders(limit));
          if (!limit.allowed) throw new AppError('Request limit reached; retry later', limit.error ? 'RATE_LIMIT_UNAVAILABLE' : 'RATE_LIMIT_EXCEEDED', limit.error ? 503 : 429);
        }
        const publicDelivery = req.method === 'GET' && pathname.startsWith('/api/v1/delivery/') && pathname !== '/api/v1/delivery/grants';
        let principal = undefined;
        if (!exempt && !identityPaths.has(pathname) && !publicDelivery) principal = await authenticateRequest(req, requiredScope);
        if (principal) {
          const limit = await rateLimiter.checkRateLimit('principal:' + principal.workspaceId + ':' + (principal.apiKeyId || principal.userId || principal.workerId), rateLimiter.classifyRoute(req.method, pathname));
          Object.assign(headers, rateLimiter.getHeaders(limit));
          if (!limit.allowed) throw new AppError('Request limit reached; retry later', limit.error ? 'RATE_LIMIT_UNAVAILABLE' : 'RATE_LIMIT_EXCEEDED', limit.error ? 503 : 429);
        }
        const payload = mutation ? await readPayload(req) : null;
        const rawKey = mutation ? req.headers.get('idempotency-key') : null;
        if (rawKey && (!/^[\x21-\x7E]{1,128}$/.test(rawKey))) throw AppError.badRequest('Idempotency-Key must contain 1–128 visible ASCII characters');
        // Never persist raw API/webhook secrets or identity cookies in replay records.
        if (rawKey && (identityPaths.has(pathname) || /\/developer\/keys(?:\/|$)/.test(pathname) || pathname === '/api/v1/webhooks' || /\/(refresh-capability|delivery-grant)$/.test(pathname) || pathname === '/api/v1/delivery/grants' || /\/uploads\/(sessions|presigned)$/.test(pathname))) throw AppError.badRequest('Idempotency-Key is not supported on credential-issuing endpoints');
        let key: string | undefined;
        let executionToken: string | undefined;
        const route = pathname + req.nextUrl.search;
        if (rawKey && principal) {
          key = crypto.createHash('sha256').update(JSON.stringify([principal.type, principal.apiKeyId || principal.userId || principal.workerId, principal.role, principal.scopes, rawKey])).digest('hex');
          const reservation = await idempotencyService.reserveOrGetCached(principal.workspaceId, key, route, req.method, payload);
          if (reservation.action === 'cached' && reservation.cachedRecord) {
            const cached = reservation.cachedRecord;
            response = Response.json(cached.response_body, { status: cached.response_status, headers: { ...cached.response_headers, 'Idempotency-Replayed': 'true' } });
          } else {
            executionToken = reservation.executionToken!;
            if (isSupabaseAdminConfigured()) {
              const { data, error } = await supabaseAdmin.rpc('begin_idempotent_execution', { p_workspace_id: principal.workspaceId, p_key: key, p_token: executionToken });
              if (error || !data) throw AppError.serviceUnavailable('Unable to start idempotent execution');
            }
            timer = setInterval(() => { void idempotencyService.renewLease(principal!.workspaceId, key!, executionToken!).catch(() => console.error(JSON.stringify({ event: 'idempotency_heartbeat_failed', request_id: requestId })));  }, 15000);
            response = await handler(req, context as C);
            const body = await response.clone().json();
            const saved = await idempotencyService.saveResponse(principal.workspaceId, key, route, payload, response.status, Object.fromEntries(response.headers.entries()), body, 24, executionToken);
            if (!saved.success) throw AppError.serviceUnavailable('Operation outcome requires reconciliation; retry with the same key');
          }
        } else {
          response = await handler(req, context as C);
        }
      } catch (error) { response = errorResponse(error, requestId); }
      finally { if (timer) clearInterval(timer); }
      for (const [key,value] of Object.entries(headers)) response.headers.set(key,value);
      if (mutation || !publicPaths.has(pathname) && !pathname.includes('/delivery/')) response.headers.set('Cache-Control','private, no-store');
      const principal = requestState.getStore()?.principal;
      if (principal && isSupabaseAdminConfigured()) {
        try {
        const { error } = await supabaseAdmin.from('api_request_logs').insert({
          id: 'log_' + crypto.randomUUID(), request_id: requestId, workspace_id: principal.workspaceId,
          api_key_id: principal.apiKeyId || null, service_account_id: principal.serviceAccountId || null,
          method: req.method, route: pathname, status_code: response.status, duration_ms: Date.now()-start,
          user_agent: req.headers.get('user-agent')?.slice(0,256) || null,
        });
        if (error) console.error(JSON.stringify({ event: 'api_log_failed', request_id: requestId, code: error.code }));
        } catch { console.error(JSON.stringify({ event: 'api_log_failed', request_id: requestId })); }
      }
      return response;
    });
  };
}
