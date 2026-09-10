import { NextResponse } from 'next/server';
import { healthService } from '@/lib/platform/healthService';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/health/live
 * Fast In-Memory Liveness Probe: Verifies API process is running.
 * Never executes external database or storage checks.
 */
export async function GET() {
  const result = healthService.getLiveness();
  return NextResponse.json(result, {
    status: 200,
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}
