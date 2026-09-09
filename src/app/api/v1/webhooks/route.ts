import { NextRequest } from 'next/server';
import { webhookService } from '@/services/webhookService';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { AppError } from '@/lib/errors/app-error';

export async function GET(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'webhooks:read');
    const endpoints = await webhookService.listEndpoints(principal.workspaceId);
    return successResponse(endpoints);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'webhooks:write');
    const body = await req.json();

    if (!body.name || !body.url) {
      throw AppError.badRequest('Webhook name and destination url are required');
    }

    const events = Array.isArray(body.events) && body.events.length > 0 ? body.events : ['asset.created', 'upload.completed'];

    const { endpoint, secret } = await webhookService.createEndpoint({
      workspaceId: principal.workspaceId,
      name: body.name,
      url: body.url,
      events,
    });

    return successResponse(
      {
        endpoint,
        signing_secret: secret,
        warning: 'Copy this webhook signing secret now to verify HMAC-SHA256 signatures in your receiver.',
      },
      {},
      201
    );
  } catch (error) {
    return errorResponse(error);
  }
}
