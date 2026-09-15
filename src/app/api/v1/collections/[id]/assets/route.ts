import { withApiRoute } from '@/lib/platform/apiRoute';
import { NextRequest } from 'next/server';
import { collectionService } from '@/services/collectionService';
import { assetService } from '@/services/assetService';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { AppError } from '@/lib/errors/app-error';

async function handleGET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const principal = await authenticateRequest(req, 'collections:read');
    const result = await assetService.listAssets({
      workspaceId: principal.workspaceId,
      collectionId: id,
    });
    return successResponse(result.assets, {
      pagination: {
        total: result.total,
        page: result.page,
        limit: result.limit,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const principal = await authenticateRequest(req, 'collections:write');
    const body = await req.json();

    if (!body?.asset_id) {
      throw AppError.badRequest('asset_id is required');
    }

    await collectionService.addAssetToCollection(
      principal.workspaceId,
      id,
      body.asset_id,
      principal.userId
    );

    return successResponse({ added: true, collection_id: id, asset_id: body.asset_id });
  } catch (error) {
    return errorResponse(error);
  }
}

export const dynamic = 'force-dynamic';

export const GET = withApiRoute(handleGET, 'collections:read');

export const POST = withApiRoute(handlePOST, 'collections:write');
