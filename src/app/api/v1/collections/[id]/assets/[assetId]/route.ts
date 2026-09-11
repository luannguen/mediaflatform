import { NextRequest } from 'next/server';
import { collectionService } from '@/services/collectionService';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; assetId: string }> }
) {
  try {
    const { id, assetId } = await params;
    const principal = await authenticateRequest(req, 'collections:write');
    await collectionService.removeAssetFromCollection(principal.workspaceId, id, assetId);
    return successResponse({ removed: true, collection_id: id, asset_id: assetId });
  } catch (error) {
    return errorResponse(error);
  }
}
