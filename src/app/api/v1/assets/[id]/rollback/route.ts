import { NextRequest } from 'next/server';
import { assetService } from '@/services/assetService';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { AppError } from '@/lib/errors/app-error';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const principal = await authenticateRequest(req, 'assets:write');
    const { id: assetId } = await params;
    const body = await req.json();

    const versionNumber = parseInt(body.version_number || body.version, 10);
    if (isNaN(versionNumber) || versionNumber < 1) {
      throw AppError.badRequest('Field "version_number" must be a positive integer');
    }

    const asset = await assetService.rollbackAssetVersion(
      assetId,
      versionNumber,
      principal.workspaceId
    );

    return successResponse(
      {
        message: `Asset successfully rolled back to version ${versionNumber}`,
        asset,
      },
      {},
      200
    );
  } catch (error) {
    return errorResponse(error);
  }
}
