import { withApiRoute } from '@/lib/platform/apiRoute';
import { NextRequest } from 'next/server';
import { webhookService } from '@/services/webhookService';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';

async function handleGET(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'webhooks:read');
    const endpointId = req.nextUrl.searchParams.get('endpoint_id') || undefined;
    const deliveries = await webhookService.listDeliveries(endpointId, principal.workspaceId);
    return successResponse(deliveries);
  } catch (error) {
    return errorResponse(error);
  }
}

export const dynamic = 'force-dynamic';

export const GET = withApiRoute(handleGET, 'webhooks:read');
