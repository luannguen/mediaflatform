import { NextRequest } from 'next/server';
import { assetService } from '@/services/assetService';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const principal = await authenticateRequest(req, 'assets:read');
    const asset = await assetService.getAssetById(id, principal.workspaceId);
    return successResponse(asset);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const principal = await authenticateRequest(req, 'assets:write');
    const body = await req.json();

    const updated = await assetService.updateAsset(id, principal.workspaceId, body, principal);
    return successResponse(updated);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const principal = await authenticateRequest(req, 'assets:delete');
    const { searchParams } = new URL(req.url);
    const force = searchParams.get('force') === 'true';
    const action = searchParams.get('action') || 'trash'; // 'trash' or 'purge'

    if (action === 'trash') {
      const trashed = await assetService.trashAsset(id, principal.workspaceId);
      return successResponse(trashed, { message: 'Asset moved to trash' });
    }

    // Purge / Hard Delete (Checks active references & authorization)
    const result = await assetService.safeDeleteAsset(id, principal.workspaceId, force, principal);
    return successResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}
