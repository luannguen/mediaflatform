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

// In-memory fallback bucket store for development/testing
const memoryBuckets = new Map<string, { tokens: number; resetAt: number }>();

export const rateLimiter = {
  /**
   * Determine route class from HTTP method and URL pathname
   */
  classifyRoute(method: string, pathname: string): RouteClass {
    const m = method.toUpperCase();
    if (pathname.includes('/uploads/')) return 'upload';
    if (pathname.includes('/delivery/') && (pathname.includes('w=') || pathname.includes('format='))) {
      return 'expensive_transform';
    }
    if (pathname.startsWith('/api/v1/admin/')) return 'admin';
    if (m === 'GET' || m === 'HEAD') return 'read';
    if (m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE') return 'write';
    return 'default';
  },

  /**
   * Check and consume rate limit for a caller identifier (API Key ID, IP, or Workspace ID)
   */
  async checkRateLimit(
    identifier: string,
    routeClass: RouteClass = 'default'
  ): Promise<RateLimitResult> {
    const limit = ROUTE_CLASS_LIMITS[routeClass] || ROUTE_CLASS_LIMITS.default;
    const bucketKey = `rl:${identifier}:${routeClass}`;
    const now = Date.now();
    const windowMs = WINDOW_SECONDS * 1000;

    // Fast In-Memory Check for testing & local development
    if (!isSupabaseAdminConfigured() || process.env.NODE_ENV === 'test') {
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

    // Distributed PostgreSQL-backed bucket storage
    try {
      const resetDate = new Date(now + windowMs);
      const { data, error } = await supabaseAdmin
        .from('rate_limit_buckets')
        .select('*')
        .eq('key', bucketKey)
        .maybeSingle();

      if (error || !data) {
        // Create new bucket
        await supabaseAdmin.from('rate_limit_buckets').upsert({
          key: bucketKey,
          tokens_remaining: limit - 1,
          last_refill_at: new Date().toISOString(),
          expires_at: resetDate.toISOString(),
        });
        return {
          allowed: true,
          limit,
          remaining: limit - 1,
          resetSeconds: WINDOW_SECONDS,
        };
      }

      const expiresAt = new Date(data.expires_at).getTime();
      if (now >= expiresAt) {
        // Window expired, reset tokens
        await supabaseAdmin
          .from('rate_limit_buckets')
          .update({
            tokens_remaining: limit - 1,
            last_refill_at: new Date().toISOString(),
            expires_at: resetDate.toISOString(),
          })
          .eq('key', bucketKey);
        return {
          allowed: true,
          limit,
          remaining: limit - 1,
          resetSeconds: WINDOW_SECONDS,
        };
      }

      if (data.tokens_remaining > 0) {
        const nextTokens = data.tokens_remaining - 1;
        await supabaseAdmin
          .from('rate_limit_buckets')
          .update({ tokens_remaining: nextTokens })
          .eq('key', bucketKey);
        const resetSeconds = Math.max(1, Math.ceil((expiresAt - now) / 1000));
        return {
          allowed: true,
          limit,
          remaining: nextTokens,
          resetSeconds,
        };
      }

      // Exhausted
      const retryAfter = Math.max(1, Math.ceil((expiresAt - now) / 1000));
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetSeconds: retryAfter,
        retryAfterSeconds: retryAfter,
      };
    } catch (err: any) {
      console.warn('[RateLimiter] Database bucket error, fail open for reliability:', err.message);
      return {
        allowed: true,
        limit,
        remaining: limit,
        resetSeconds: WINDOW_SECONDS,
      };
    }
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
