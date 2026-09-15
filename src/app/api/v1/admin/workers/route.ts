import { withApiRoute } from '@/lib/platform/apiRoute';
import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { workerFleetService } from '@/services/workerFleetService';
import { extractRequestId } from '@/lib/platform/requestContext';
import { errorResponse } from '@/lib/errors/response';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/admin/workers
 * Admin Operational Fleet Visibility: Returns list of registered worker instances,
 * active heartbeats, processing capabilities, and stale state.
 */
async function handleGET(req: NextRequest) {
  const requestId = extractRequestId(req);
  try {
    const principal = await authenticateRequest(req, 'system:read');

    const workers = await workerFleetService.listWorkers();

    return NextResponse.json(
      {
        success: true,
        data: {
          total: workers.length,
          online: workers.filter((w) => w.status === 'online').length,
          stale: workers.filter((w) => w.status === 'stale').length,
          workers,
        },
      },
      {
        status: 200,
        headers: {
          'X-Request-Id': requestId,
          'Cache-Control': 'private, no-cache, no-store, must-revalidate',
        },
      }
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export const GET = withApiRoute(handleGET, 'system:read');
