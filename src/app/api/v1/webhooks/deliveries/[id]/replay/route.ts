import { withApiRoute } from '@/lib/platform/apiRoute';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { webhookService } from '@/services/webhookService';
import { auditService } from '@/services/auditService';
import { extractRequestId } from '@/lib/platform/requestContext';
import { successResponse, errorResponse } from '@/lib/errors/response';

/**
 * POST /api/v1/webhooks/deliveries/[id]/replay
 * Safe Webhook Replay: Re-dispatches a past webhook delivery attempt without mutating historical attempts.
 */
async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = extractRequestId(req);
  try {
    const { id } = await params;
    const principal = await authenticateRequest(req, 'webhooks:write');

    const newDelivery = await webhookService.replayDelivery(id, principal.workspaceId);

    // Record audit event
    await auditService.recordCritical({
      workspaceId: principal.workspaceId,
      actorType: principal.type === 'user' ? 'user' : 'service_account',
      actorId: principal.userId || principal.serviceAccountId || 'unknown',
      action: 'webhook.replayed',
      resourceType: 'webhook_delivery',
      resourceId: id,
      changesSummary: {
        original_delivery_id: id,
        new_delivery_id: newDelivery.id,
        event_id: newDelivery.event_id,
        status: newDelivery.status,
      },
      requestId,
    });

    return successResponse(newDelivery, { request_id: requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export const dynamic = 'force-dynamic';

export const POST = withApiRoute(handlePOST, 'webhooks:write');
