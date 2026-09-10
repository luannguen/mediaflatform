import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';

export type RouteClass = 'read' | 'write' | 'upload' | 'expensive_transform' | 'admin' | 'default';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
  retryAfterSeconds?: number;
  enforcement?: 'authoritative' | 'degraded';
  error?: string;
}

/**
 * Route Class Quotas for Windowed Token Bucket
 */
const ROUTE_CLASS_LIMITS: Record<RouteClass, number> = {
  read: 120,
  write: 60,
  upload: 30,
  expensive_transform: 20,
  admin: 40,
  default: 60,
};

const WINDOW_SECONDS = 60;

/**
 * Central Rate Limit Failure Policy when distributed PostgreSQL limiter is unavailable.
 * In production:
 * - 'read': fail_open (allows read traffic with degraded telemetry)
 * - 'write', 'upload', 'expensive_transform', 'admin': fail_closed (preserves backend protection)
 */
export const RATE_LIMIT_FAILURE_POLICY: Record<RouteClass, 'fail_open' | 'fail_closed'> = {
  read: 'fail_open',
  write: 'fail_closed',
  upload: 'fail_closed',
  expensive_transform: 'fail_closed',
  admin: 'fail_closed',
  default: 'fail_closed',
};

// In-memory fallback bucket store for testing or offline environments only
const memoryBuckets = new Map<string, { tokens: number; resetAt: number }>();

export const rateLimiter = {
  /**
   * Determine route class from HTTP method and URL/pathname/searchParams
   */
  classifyRoute(
    method: string,
    urlOrPathname: string,
    searchParams?: URLSearchParams | Record<string, string>
  ): RouteClass {
    let pathname = urlOrPathname;
    let query = '';
    if (urlOrPathname.includes('?')) {
      const parts = urlOrPathname.split('?');
      pathname = parts[0];
      query = parts[1];
    }

    const hasTransform =
      (searchParams &&
        (searchParams instanceof URLSearchParams
          ? searchParams.has('w') || searchParams.has('format') || searchParams.has('h') || searchParams.has('q')
          : 'w' in searchParams || 'format' in searchParams || 'h' in searchParams || 'q' in searchParams)) ||
      query.includes('w=') ||
      query.includes('format=');

    if (pathname.includes('/uploads')) return 'upload';
    if (pathname.includes('/delivery/') && hasTransform) {
      return 'expensive_transform';
    }
    if (pathname.startsWith('/api/v1/admin/')) return 'admin';
    const m = method.toUpperCase();
    if (m === 'GET' || m === 'HEAD') return 'read';
    if (m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE') return 'write';
    return 'default';
  },

  /**
   * Check and atomically consume rate limit for a caller identifier (API Key ID, IP, or Workspace ID).
   * Uses Windowed Token Bucket algorithm synchronized via PostgreSQL RPC consume_rate_limit_token.
   */
  async checkRateLimit(
    identifier: string,
    routeClass: RouteClass = 'default'
  ): Promise<RateLimitResult> {
    const limit = ROUTE_CLASS_LIMITS[routeClass] || ROUTE_CLASS_LIMITS.default;
    const bucketKey = `rl:${identifier}:${routeClass}`;
    const now = Date.now();
    const windowMs = WINDOW_SECONDS * 1000;

    // Fast atomic in-memory check for offline/testing mode without Supabase
    if (!isSupabaseAdminConfigured()) {
      let bucket = memoryBuckets.get(bucketKey);
      if (!bucket || now >= bucket.resetAt) {
        bucket = { tokens: limit - 1, resetAt: now + windowMs };
        memoryBuckets.set(bucketKey, bucket);
        return {
          allowed: true,
          limit,
          remaining: bucket.tokens,
          resetSeconds: Math.ceil(windowMs / 1000),
          enforcement: 'authoritative',
        };
      }

      if (bucket.tokens > 0) {
        bucket.tokens -= 1;
        const resetSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
        return {
          allowed: true,
          limit,
          remaining: bucket.tokens,
          resetSeconds,
          enforcement: 'authoritative',
        };
      }

      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetSeconds: retryAfter,
        retryAfterSeconds: retryAfter,
        enforcement: 'authoritative',
      };
    }

    // Distributed atomic PostgreSQL RPC execution with row-level locks
    let lastError: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { data, error } = await supabaseAdmin.rpc('consume_rate_limit_token', {
          p_key: bucketKey,
          p_limit: limit,
          p_window_seconds: WINDOW_SECONDS,
        });

        if (error || !data) {
          throw error || new Error('No data returned from consume_rate_limit_token');
        }

        return {
          allowed: Boolean(data.allowed),
          limit: Number(data.limit) || limit,
          remaining: Number(data.remaining) || 0,
          resetSeconds: Number(data.reset_seconds) || WINDOW_SECONDS,
          retryAfterSeconds: data.retry_after_seconds ? Number(data.retry_after_seconds) : undefined,
          enforcement: 'authoritative',
        };
      } catch (err: any) {
        lastError = err;
        if (attempt < 2 && (err.message?.includes('fetch') || err.code === 'ECONNRESET' || err.name === 'TypeError')) {
          await new Promise((resolve) => setTimeout(resolve, 35 * (attempt + 1)));
          continue;
        }
        break;
      }
    }

    console.warn('[RateLimiter] Distributed PostgreSQL RPC failure:', lastError?.message);

    // Emergency local fallback: only permitted if explicitly opted in via env
    const allowLocalFallback = process.env.ALLOW_LOCAL_RATE_LIMIT_FALLBACK === 'true';
    if (allowLocalFallback) {
      let bucket = memoryBuckets.get(bucketKey);
      if (!bucket || now >= bucket.resetAt) {
        bucket = { tokens: limit - 1, resetAt: now + windowMs };
        memoryBuckets.set(bucketKey, bucket);
        return {
          allowed: true,
          limit,
          remaining: bucket.tokens,
          resetSeconds: Math.ceil(windowMs / 1000),
          enforcement: 'degraded',
        };
      }

      if (bucket.tokens > 0) {
        bucket.tokens -= 1;
        return {
          allowed: true,
          limit,
          remaining: bucket.tokens,
          resetSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
          enforcement: 'degraded',
        };
      }

      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetSeconds: retryAfter,
        retryAfterSeconds: retryAfter,
        enforcement: 'degraded',
      };
    }

    // Explicit production failure semantics based on route class policy
    const policy = RATE_LIMIT_FAILURE_POLICY[routeClass] || 'fail_closed';
    if (policy === 'fail_open') {
      return {
        allowed: true,
        limit,
        remaining: 1,
        resetSeconds: WINDOW_SECONDS,
        enforcement: 'degraded',
      };
    }

    // Fail Closed: Return explicit 503-style rate limit failure to protect infrastructure
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetSeconds: WINDOW_SECONDS,
      retryAfterSeconds: WINDOW_SECONDS,
      error: 'RATE_LIMIT_UNAVAILABLE',
      enforcement: 'degraded',
    };
  },

  getHeaders(result: RateLimitResult): Record<string, string> {
    const headers: Record<string, string> = {
      'RateLimit-Limit': String(result.limit),
      'RateLimit-Remaining': String(Math.max(0, result.remaining)),
      'RateLimit-Reset': String(result.resetSeconds),
    };
    if (!result.allowed && (result.retryAfterSeconds || result.resetSeconds)) {
      headers['Retry-After'] = String(result.retryAfterSeconds || result.resetSeconds);
    }
    if (result.enforcement === 'degraded') {
      headers['X-RateLimit-Enforcement'] = 'degraded';
    }
    return headers;
  },
};
