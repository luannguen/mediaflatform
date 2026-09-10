import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { developerService } from '@/services/developerService';
import { auditService } from '@/services/auditService';
import { extractRequestId } from '@/lib/platform/requestContext';
import { successResponse, errorResponse } from '@/lib/errors/response';

/**
 * POST /api/v1/developer/keys/[id]/rotate
 * Rotates an existing API key by generating a successor key with zero downtime.
 * Old key remains valid during the grace period (default 7 days).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = extractRequestId(req);
  try {
    const { id } = await params;
    const principal = await authenticateRequest(req);
    const body = await req.json().catch(() => ({}));
    const gracePeriodDays = Number(body.grace_period_days) || 7;

    const result = await developerService.rotateApiKey(id, principal.workspaceId, gracePeriodDays);

    // Durable audit logging
    await auditService.recordCritical({
      workspaceId: principal.workspaceId,
      actorType: principal.type === 'user' ? 'user' : 'service_account',
      actorId: principal.userId || principal.serviceAccountId || 'unknown',
      action: 'api_key.rotated',
      resourceType: 'api_key',
      resourceId: id,
      changesSummary: {
        old_key_id: id,
        new_key_id: result.newKeyRecord.id,
        grace_period_days: gracePeriodDays,
      },
      requestId,
    });

    return successResponse({
      raw_key: result.rawKey,
      new_key: result.newKeyRecord,
      old_key: result.oldKeyRecord,
    }, { request_id: requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
