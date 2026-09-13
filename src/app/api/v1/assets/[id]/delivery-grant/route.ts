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

function allowedGrantPermissions(asset: any): string[] {
  if (asset.asset_type === 'video') return ['poster:read', 'preview:read', 'hls:read'];
  return ['asset:read'];
}

function sanitizeRequestedPermissions(requested: string[], allowed: string[]): string[] {
  const unique = [...new Set(requested.map((p) => String(p).trim()).filter(Boolean))];
  if (unique.some((p) => p === '*' || !allowed.includes(p))) {
    throw AppError.forbidden(
      'Requested delivery grant permission is not allowed for this asset',
      ErrorCodes.DELIVERY_GRANT_FORBIDDEN
    );
  }
  return unique.length > 0 ? unique : allowed;
}

async function handleDeliveryGrant(req: NextRequest, paramsPromise: Promise<{ id: string }>) {
  const requestId = extractRequestId(req);
  try {
    const { id: assetId } = await paramsPromise;
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

    const auth = authorize(principal, 'asset.read', asset);
    if (!auth.allowed) {
      throw AppError.forbidden(
        auth.message || 'Forbidden: Cross-workspace asset access denied',
        auth.code || ErrorCodes.PERMISSION_DENIED
      );
    }

    if (asset.status === 'quarantined') {
      throw AppError.forbidden(
        'Asset is quarantined for security review and cannot be granted for delivery',
        ErrorCodes.ASSET_QUARANTINED
      );
    }

    const allowed = allowedGrantPermissions(asset);
    let requested: string[] = [...allowed];
    let ttlSeconds: number | undefined;

    if (req.method === 'GET') {
      const qPerms = req.nextUrl.searchParams.get('permissions');
      if (qPerms) requested = qPerms.split(',');
      const qTtl = req.nextUrl.searchParams.get('ttl_seconds');
      if (qTtl) {
        const parsed = Number.parseInt(qTtl, 10);
        if (Number.isFinite(parsed)) ttlSeconds = parsed;
      }
    } else {
      let body: any = {};
      try {
        body = await req.json();
      } catch {
        body = {};
      }
      if (Array.isArray(body.permissions) && body.permissions.length > 0) requested = body.permissions;
      if (typeof body.ttl_seconds === 'number') ttlSeconds = body.ttl_seconds;
    }

    const permissions = sanitizeRequestedPermissions(requested, allowed);
    const isVideo = asset.asset_type === 'video';

    if (asset.visibility === 'public') {
      return successResponse(
        {
          grant: null,
          is_public: true,
          asset_id: asset.id,
          workspace_id: asset.workspace_id,
          expires_at: null,
          permissions: ['public'],
          urls: isVideo
            ? {
                poster: `/api/v1/delivery/video/${asset.id}/poster.webp`,
                preview: `/api/v1/delivery/video/${asset.id}/preview.webp`,
                master_playlist: `/api/v1/delivery/video/${asset.id}/master.m3u8`,
              }
            : { asset: `/api/v1/delivery/${asset.id}` },
        },
        { request_id: requestId },
        200
      );
    }

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
        urls: isVideo
          ? {
              poster: `/api/v1/delivery/video/${asset.id}/poster.webp?grant=${encodedGrant}`,
              preview: `/api/v1/delivery/video/${asset.id}/preview.webp?grant=${encodedGrant}`,
              master_playlist: `/api/v1/delivery/video/${asset.id}/master.m3u8?grant=${encodedGrant}`,
            }
          : { asset: `/api/v1/delivery/${asset.id}?grant=${encodedGrant}` },
      },
      { request_id: requestId },
      201
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleDeliveryGrant(req, params);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleDeliveryGrant(req, params);
}
