import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { assetService } from '@/services/assetService';
import { authorize } from '@/lib/security/resourceAuthorization';
import { mintDeliveryGrant } from '@/lib/security/delivery-grant';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { AppError } from '@/lib/errors/app-error';
import { ErrorCodes } from '@/lib/errors/codes';
import { extractRequestId } from '@/lib/platform/requestContext';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/assets/:id/delivery-grant
 * Mint a scoped, short-lived cryptographic delivery grant for browser media tags (img, video, HLS)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = extractRequestId(req);
  try {
    const { id: assetId } = await params;
    const principal = await authenticateRequest(req, 'assets:read');

    let asset: any = null;
    try {
      asset = await assetService.getAssetGlobally(assetId);
    } catch {
      asset = null;
    }

    if (!asset || asset.status === 'deleted' || asset.status === 'trashed') {
      throw AppError.notFound(`Asset [${assetId}] not found`);
    }

    // Tenant authorization check
    const auth = authorize(principal, 'asset.read', asset);
    if (!auth.allowed) {
      throw AppError.forbidden(auth.message || 'Forbidden: Cross-workspace asset access denied', auth.code || ErrorCodes.PERMISSION_DENIED);
    }

    if (asset.status === 'quarantined') {
      throw AppError.forbidden(
        'Asset is quarantined for security review and cannot be granted for delivery',
        'ASSET_QUARANTINED'
      );
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // Empty body allowed
    }

    const permissions = Array.isArray(body.permissions) && body.permissions.length > 0
      ? body.permissions
      : ['poster:read', 'preview:read', 'hls:read'];

    const ttlSeconds = typeof body.ttl_seconds === 'number' ? body.ttl_seconds : undefined;

    // If asset is public, grant is not required; clean URLs returned
    if (asset.visibility === 'public') {
      return successResponse(
        {
          grant: null,
          is_public: true,
          asset_id: asset.id,
          workspace_id: asset.workspace_id,
          expires_at: null,
          permissions: ['*'],
          urls: {
            poster: `/api/v1/delivery/video/${asset.id}/poster.webp`,
            preview: `/api/v1/delivery/video/${asset.id}/preview.webp`,
            master_playlist: `/api/v1/delivery/video/${asset.id}/master.m3u8`,
          },
        },
        { request_id: requestId },
        200
      );
    }

    // Private or workspace-scoped asset: mint signed Delivery Grant
    const grantData = mintDeliveryGrant({
      assetId: asset.id,
      workspaceId: asset.workspace_id,
      permissions,
      ttlSeconds,
    });

    const encodedGrant = encodeURIComponent(grantData.grant);

    return successResponse(
      {
        grant: grantData.grant,
        is_public: false,
        asset_id: asset.id,
        workspace_id: asset.workspace_id,
        expires_at: grantData.expires_at,
        permissions: grantData.permissions,
        urls: {
          poster: `/api/v1/delivery/video/${asset.id}/poster.webp?grant=${encodedGrant}`,
          preview: `/api/v1/delivery/video/${asset.id}/preview.webp?grant=${encodedGrant}`,
          master_playlist: `/api/v1/delivery/video/${asset.id}/master.m3u8?grant=${encodedGrant}`,
        },
      },
      { request_id: requestId },
      201
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
