import { NextRequest } from 'next/server';
import { assetService } from '@/services/assetService';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { AppError } from '@/lib/errors/app-error';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const principal = await authenticateRequest(req, 'assets:read');
    const { id: assetId } = await params;

    const versions = await assetService.listAssetVersions(assetId, principal.workspaceId);
    return successResponse(versions);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const principal = await authenticateRequest(req, 'assets:write');
    const { id: assetId } = await params;
    const body = await req.json();

    if (!body.storage_key && !body.storageKey) {
      throw AppError.badRequest('Field "storage_key" is required to create a new version');
    }

    const result = await assetService.createAssetVersion(
      assetId,
      {
        storageKey: body.storage_key || body.storageKey,
        storageUrl: body.storage_url || body.storageUrl,
        sizeBytes: typeof body.size_bytes === 'number' ? body.size_bytes : (body.sizeBytes || 0),
        mimeType: body.mime_type || body.mimeType || 'application/octet-stream',
        checksum: body.checksum,
        width: body.width,
        height: body.height,
        createdBy: principal.userId || principal.serviceAccountId,
        comment: body.comment,
      },
      principal.workspaceId
    );

    return successResponse(result, {}, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
