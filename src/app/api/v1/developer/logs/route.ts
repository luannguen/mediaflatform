import { withApiRoute } from '@/lib/platform/apiRoute';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { developerService } from '@/services/developerService';
import { extractRequestId } from '@/lib/platform/requestContext';
import { successResponse, errorResponse } from '@/lib/errors/response';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/developer/logs
 * Query API Request Logs for the authenticated workspace with redaction and filtering.
 */
async function handleGET(req: NextRequest) {
  const requestId = extractRequestId(req);
  try {
    const principal = await authenticateRequest(req, 'audit:read');
    const { searchParams } = new URL(req.url);

    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 50;
    const offset = searchParams.get('offset') ? parseInt(searchParams.get('offset')!, 10) : 0;
    const route = searchParams.get('route') || undefined;
    const statusCode = searchParams.get('status_code') ? parseInt(searchParams.get('status_code')!, 10) : undefined;
    const searchRequestId = searchParams.get('request_id') || undefined;
    const applicationId = searchParams.get('application_id') || undefined;

    const result = await developerService.listApiRequestLogs(principal.workspaceId, {
      limit,
      offset,
      route,
      statusCode,
      requestId: searchRequestId,
      applicationId,
    });

    return successResponse(result.logs, {
      request_id: requestId,
      pagination: {
        total: result.total,
        limit,
        offset,
      },
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export const GET = withApiRoute(handleGET, 'audit:read');
