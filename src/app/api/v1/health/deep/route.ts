import { withApiRoute } from '@/lib/platform/apiRoute';
import { NextRequest, NextResponse } from 'next/server';
import { healthService } from '@/lib/platform/healthService';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { extractRequestId } from '@/lib/platform/requestContext';
import { errorResponse } from '@/lib/errors/response';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/health/deep
 * Protected Deep Health & Diagnostics Probe.
 * Requires system:read scope or Admin authentication.
 * Executes live write-read-delete storage probe, verifies critical RPCs, queue depth, and worker fleet.
 */
async function handleGET(req: NextRequest) {
  const requestId = extractRequestId(req);
  try {
    // Protected endpoint: must have system:read scope or be admin
    await authenticateRequest(req, 'system:read');

    const result = await healthService.getDeepHealth(requestId);

    const httpStatus = result.status === 'failed' ? 503 : 200;

    return NextResponse.json(result, {
      status: httpStatus,
      headers: {
        'X-Request-Id': requestId,
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export const GET = withApiRoute(handleGET, 'system:read');
