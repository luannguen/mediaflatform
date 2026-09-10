import { NextRequest } from 'next/server';
import { POST as handleAssetDeliveryGrant } from '@/app/api/v1/assets/[id]/delivery-grant/route';
import { AppError } from '@/lib/errors/app-error';
import { errorResponse } from '@/lib/errors/response';
import { extractRequestId } from '@/lib/platform/requestContext';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/delivery/grants
 * Batch or general entry point for minting delivery grants with { asset_id: string }
 */
export async function POST(req: NextRequest) {
  const requestId = extractRequestId(req);
  try {
    const clone = req.clone();
    let body: any = {};
    try {
      body = await clone.json();
    } catch {
      throw AppError.badRequest('Request body JSON is required with field "asset_id"');
    }

    if (!body.asset_id) {
      throw AppError.badRequest('Field "asset_id" is required');
    }

    return handleAssetDeliveryGrant(req, {
      params: Promise.resolve({ id: body.asset_id }),
    });
  } catch (err) {
    return errorResponse(err, requestId);
  }
}
