import { NextRequest } from 'next/server';
import { assetService } from '@/services/assetService';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { AssetType, AssetStatus } from '@/types/database';

export async function GET(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'assets:read');
    const { searchParams } = new URL(req.url);

    const folderId = searchParams.get('folder_id') || undefined;
    const assetType = (searchParams.get('type') as AssetType | 'all') || undefined;
    const status = (searchParams.get('status') as AssetStatus | 'all') || undefined;
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
      assetType,
      status,
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

export async function POST(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'assets:write');
    const body = await req.json();

    const asset = await assetService.createAsset({
      ...body,
      originalFilename: body.original_filename || body.originalFilename || 'unnamed.bin',
      displayName: body.display_name || body.displayName,
      assetType: body.asset_type || body.assetType,
      mimeType: body.mime_type || body.mimeType || 'application/octet-stream',
      sizeBytes: typeof body.size_bytes === 'number' ? body.size_bytes : (body.sizeBytes || 0),
      storageKey: body.storage_key || body.storageKey || `manual/${Date.now()}`,
      storageUrl: body.storage_url || body.storageUrl,
      workspaceId: principal.workspaceId,
      createdByServiceAccountId: principal.serviceAccountId,
    });

    return successResponse(asset, {}, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
