import { withApiRoute } from '@/lib/platform/apiRoute';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { assetService } from '@/services/assetService';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { AppError } from '@/lib/errors/app-error';

async function handlePOST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await authenticateRequest(req, 'assets:write');
    const { id } = await params;
    const asset = await assetService.getAssetById(id, principal.workspaceId);
    if (asset.status === 'active') return successResponse(asset);
    if (asset.status !== 'trashed' || asset.metadata_json?.purge_pending) throw AppError.conflict('Asset cannot be restored in its current state');
    return successResponse(await assetService.restoreAsset(id, principal.workspaceId));
  } catch (error) { return errorResponse(error); }
}

export const dynamic = 'force-dynamic';

export const POST = withApiRoute(handlePOST, 'assets:write');
