import { withApiRoute } from '@/lib/platform/apiRoute';
import { NextResponse } from 'next/server';
import { healthService } from '@/lib/platform/healthService';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/health/live
 * Fast In-Memory Liveness Probe: Verifies API process is running.
 * Never executes external database or storage checks.
 */
async function handleGET() {
  const result = healthService.getLiveness();
  return NextResponse.json(result, {
    status: 200,
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}

export const GET = withApiRoute(handleGET);
