import { withApiRoute } from '@/lib/platform/apiRoute';
import { NextRequest } from 'next/server';
import { assetService } from '@/services/assetService';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';

async function handleGET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const principal = await authenticateRequest(req, 'assets:read');
    const asset = await assetService.getAssetById(id, principal.workspaceId);
    return successResponse(asset);
  } catch (error) {
    return errorResponse(error);
  }
}

async function handlePATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

async function handleDELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const principal = await authenticateRequest(req, 'assets:delete');
    const { searchParams } = new URL(req.url);
    const force = searchParams.get('force') === 'true';
    const actionParam = searchParams.get('action');
    const isPermanent = searchParams.get('permanent') === 'true';
    const action = actionParam || (isPermanent ? 'purge' : 'trash'); // 'trash' or 'purge'

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

export const dynamic = 'force-dynamic';

export const GET = withApiRoute(handleGET, 'assets:read');

export const PATCH = withApiRoute(handlePATCH, 'assets:write');

export const DELETE = withApiRoute(handleDELETE, 'assets:delete');
