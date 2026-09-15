import { withApiRoute } from '@/lib/platform/apiRoute';
import { NextResponse } from 'next/server';
import { healthService } from '@/lib/platform/healthService';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/health
 * Backward-compatible health alias mapping to readiness check.
 */
async function handleGET() {
  const { isReady, result } = await healthService.getReadiness();

  return NextResponse.json(
    {
      success: isReady,
      data: {
        status: isReady ? 'healthy' : 'degraded',
        platform_version: result.platform_version,
        api_version: result.api_version,
        timestamp: result.timestamp,
        checks: result.checks,
      },
    },
    {
      status: isReady ? 200 : 503,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    }
  );
}

export const GET = withApiRoute(handleGET);
