import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';

export type RouteClass = 'read' | 'write' | 'upload' | 'expensive_transform' | 'admin' | 'default';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
  retryAfterSeconds?: number;
}

const ROUTE_CLASS_LIMITS: Record<RouteClass, number> = {
  read: 120,
  write: 60,
  upload: 30,
  expensive_transform: 20,
  admin: 40,
  default: 60,
};

const WINDOW_SECONDS = 60;

// In-memory fallback bucket store for testing or offline environments
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
   * Check and atomically consume rate limit for a caller identifier (API Key ID, IP, or Workspace ID)
   * Uses PostgreSQL row-locked RPC consume_rate_limit_token for distributed concurrency safety.
   */
  async checkRateLimit(
    identifier: string,
    routeClass: RouteClass = 'default'
  ): Promise<RateLimitResult> {
    const limit = ROUTE_CLASS_LIMITS[routeClass] || ROUTE_CLASS_LIMITS.default;
    const bucketKey = `rl:${identifier}:${routeClass}`;
    const now = Date.now();
    const windowMs = WINDOW_SECONDS * 1000;

    // Fast atomic in-memory check for offline/testing mode
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
        };
      }

      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetSeconds: retryAfter,
        retryAfterSeconds: retryAfter,
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

    console.warn('[RateLimiter] Database RPC error, falling back to memory bucket:', lastError?.message);
    // Fallback to in-memory bucket to prevent complete lockout while remaining resilient
      let bucket = memoryBuckets.get(bucketKey);
      if (!bucket || now >= bucket.resetAt) {
        bucket = { tokens: limit - 1, resetAt: now + windowMs };
        memoryBuckets.set(bucketKey, bucket);
        return {
          allowed: true,
          limit,
          remaining: bucket.tokens,
          resetSeconds: Math.ceil(windowMs / 1000),
        };
      }

      if (bucket.tokens > 0) {
        bucket.tokens -= 1;
        return {
          allowed: true,
          limit,
          remaining: bucket.tokens,
          resetSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
        };
      }

      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetSeconds: retryAfter,
        retryAfterSeconds: retryAfter,
      };
    },

  getHeaders(result: RateLimitResult): Record<string, string> {
    const headers: Record<string, string> = {
      'RateLimit-Limit': String(result.limit),
      'RateLimit-Remaining': String(Math.max(0, result.remaining)),
      'RateLimit-Reset': String(result.resetSeconds),
    };
    if (!result.allowed && result.retryAfterSeconds) {
      headers['Retry-After'] = String(result.retryAfterSeconds);
    }
    return headers;
  },
};
