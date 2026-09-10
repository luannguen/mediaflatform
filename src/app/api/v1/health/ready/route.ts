import { NextResponse } from 'next/server';
import { healthService } from '@/lib/platform/healthService';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/health/ready
 * Readiness Probe: Verifies critical infrastructure dependencies (PostgreSQL, Storage).
 * Returns HTTP 503 if any critical dependency is unavailable.
 */
export async function GET() {
  const { isReady, result } = await healthService.getReadiness();

  return NextResponse.json(result, {
    status: isReady ? 200 : 503,
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}
