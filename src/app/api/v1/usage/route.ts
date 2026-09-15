import { withApiRoute } from '@/lib/platform/apiRoute';
import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { usageService } from '@/services/usageService';
import { extractRequestId } from '@/lib/platform/requestContext';
import { errorResponse } from '@/lib/errors/response';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/usage
 * Returns workspace resource consumption, capacity limits, and quota percentages.
 */
async function handleGET(req: NextRequest) {
  const requestId = extractRequestId(req);
  try {
    const principal = await authenticateRequest(req, 'usage:read');
    const usage = await usageService.getWorkspaceUsage(principal.workspaceId);

    return NextResponse.json(
      {
        success: true,
        data: usage,
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

export const GET = withApiRoute(handleGET, 'usage:read');
