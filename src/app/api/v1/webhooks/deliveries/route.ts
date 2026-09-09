import { NextRequest } from 'next/server';
import { webhookService } from '@/services/webhookService';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';

export async function GET(req: NextRequest) {
  try {
    await authenticateRequest(req, 'webhooks:read');
    const endpointId = req.nextUrl.searchParams.get('endpoint_id') || undefined;
    const deliveries = await webhookService.listDeliveries(endpointId);
    return successResponse(deliveries);
  } catch (error) {
    return errorResponse(error);
  }
}
