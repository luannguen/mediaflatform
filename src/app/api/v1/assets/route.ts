import { AppError } from '@/lib/errors/app-error';
import { withApiRoute } from '@/lib/platform/apiRoute';
import { NextRequest } from 'next/server';
import { assetService } from '@/services/assetService';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { AssetType, AssetStatus } from '@/types/database';

async function handleGET(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'assets:read');
    const { searchParams } = new URL(req.url);

    const folderId = searchParams.get('folder_id') || undefined;
    const collectionId = searchParams.get('collection_id') || undefined;
    const assetType = ((searchParams.get('asset_type') || searchParams.get('type')) as AssetType | 'all') || undefined;
    const status = (searchParams.get('status') as AssetStatus | 'all') || undefined;
    const visibility = (searchParams.get('visibility') as 'public' | 'workspace' | 'private' | 'all') || undefined;
    const search = searchParams.get('search') || undefined;
    const cursor = searchParams.get('cursor') || undefined;
    const rawLimit = searchParams.get('limit');
    const limit = rawLimit === 'all' || rawLimit === 'unlimited' ? 'all' : parseInt(rawLimit || '24', 10);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const sort = (searchParams.get('sort') as any) || 'newest';
    const fields = searchParams.get('fields')?.split(',').map((s) => s.trim()).filter(Boolean);

    const result = await assetService.listAssets({
      workspaceId: principal.workspaceId,
      folderId,
      collectionId,
      assetType,
      status,
      visibility,
      search,
      page,
      limit,
      cursor,
      fields,
      sort,
    });

    const response = successResponse(result.assets, {
      pagination: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        has_more: result.hasMore,
        next_cursor: result.nextCursor,
      },
    });

    // Expose pagination metadata in standard HTTP headers
    response.headers.set('X-Total-Count', result.total.toString());
    response.headers.set('X-Has-More', result.hasMore ? 'true' : 'false');
    if (result.nextCursor) response.headers.set('X-Next-Cursor', result.nextCursor);
    if (result.page) response.headers.set('X-Page', result.page.toString());
    response.headers.set('X-Limit', result.limit.toString());

    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

async function handlePOST(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'assets:write');
    throw AppError.badRequest('Create assets through upload sessions so content and storage ownership can be verified');
  } catch (error) {
    return errorResponse(error);
  }
}

export const dynamic = 'force-dynamic';

export const GET = withApiRoute(handleGET, 'assets:read');

export const POST = withApiRoute(handlePOST, 'assets:write');
