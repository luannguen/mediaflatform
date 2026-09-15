import { withApiRoute } from '@/lib/platform/apiRoute';
import { NextRequest } from 'next/server';
import { assetService } from '@/services/assetService';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { AppError } from '@/lib/errors/app-error';

async function handlePATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const principal = await authenticateRequest(req, 'assets:write');
    const { id: assetId } = await params;
    const body = await req.json();

    const x = typeof body.x === 'number' ? body.x : parseFloat(body.x);
    const y = typeof body.y === 'number' ? body.y : parseFloat(body.y);

    if (isNaN(x) || isNaN(y)) {
      throw AppError.badRequest('Fields "x" and "y" must be valid numbers between 0.0 and 1.0');
    }

    const clampedX = Math.max(0.0, Math.min(1.0, Math.round(x * 1000) / 1000));
    const clampedY = Math.max(0.0, Math.min(1.0, Math.round(y * 1000) / 1000));

    const currentAsset = await assetService.getAssetById(assetId, principal.workspaceId);
    if (!currentAsset) {
      throw AppError.notFound(`Asset ${assetId} not found`);
    }

    const updatedMetadata = {
      ...(currentAsset.metadata_json || {}),
      focal_point: {
        x: clampedX,
        y: clampedY,
        updated_at: new Date().toISOString(),
      },
    };

    const updatedAsset = await assetService.updateAsset(assetId, principal.workspaceId, {
      metadata_json: updatedMetadata,
      updated_at: new Date().toISOString(), // Invalidate CDN cache
    });

    return successResponse({
      message: 'Focal point updated successfully',
      focal_point: { x: clampedX, y: clampedY },
      asset: updatedAsset,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export const dynamic = 'force-dynamic';

export const PATCH = withApiRoute(handlePATCH, 'assets:write');
