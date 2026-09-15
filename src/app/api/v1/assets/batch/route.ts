import { withApiRoute } from '@/lib/platform/apiRoute';
import { NextRequest } from 'next/server';
import { assetService } from '@/services/assetService';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { AppError } from '@/lib/errors/app-error';

async function handlePOST(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'assets:read');
    const body = await req.json();

    const assetIds = body.asset_ids || body.ids;
    if (!Array.isArray(assetIds)) {
      throw AppError.badRequest('Field "asset_ids" or "ids" must be an array of asset IDs');
    }

    if (assetIds.length > 100) {
      throw AppError.badRequest('Batch request capped at maximum 100 assets per call');
    }

    const fields = Array.isArray(body.fields) ? body.fields : undefined;
    const assets = await assetService.getAssetsBatch(assetIds, principal.workspaceId, fields);

    // If transform requested, enrich with delivery URLs
    const transform = body.transform;
    const origin = req.nextUrl.origin || '';

    const enriched = assets.map((asset) => {
      if (!transform || !asset.id) return asset;

      const q = new URLSearchParams();
      if (transform.width) q.set('w', transform.width.toString());
      if (transform.height) q.set('h', transform.height.toString());
      if (transform.format) q.set('format', transform.format);
      if (transform.quality) q.set('q', transform.quality.toString());
      if (transform.fit) q.set('fit', transform.fit);

      const qs = q.toString();
      return {
        ...asset,
        delivery_url: `${origin}/api/v1/delivery/${asset.id}${qs ? `?${qs}` : ''}`,
      };
    });

    return successResponse({
      count: enriched.length,
      assets: enriched,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export const dynamic = 'force-dynamic';

export const POST = withApiRoute(handlePOST, 'assets:read');
