import { withApiRoute } from '@/lib/platform/apiRoute';
import { NextRequest } from 'next/server';
import { developerService } from '@/services/developerService';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { AppError } from '@/lib/errors/app-error';

async function handleGET(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'apikey:read');
    const keys = await developerService.listApiKeys(principal.workspaceId);
    return successResponse(keys);
  } catch (error) {
    return errorResponse(error);
  }
}

async function handlePOST(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'apikey:create');
    const body = await req.json();

    if (!body.name) {
      throw AppError.badRequest('API key name is required');
    }

    let serviceAccountId = body.service_account_id;
    if (!serviceAccountId || serviceAccountId === 'auto_default') {
      const defaultAccount = await developerService.getOrCreateDefaultServiceAccount(principal.workspaceId);
      serviceAccountId = defaultAccount.id;
    }

    const scopes = Array.isArray(body.scopes) && body.scopes.length > 0 ? body.scopes : ['assets:read'];

    const { rawKey, keyRecord } = await developerService.createApiKey(
      principal.workspaceId,
      serviceAccountId,
      body.name,
      scopes
    );

    return successResponse(
      {
        apiKey: keyRecord,
        rawKey, // Shown exactly ONCE!
        warning: 'Make sure to copy your API key now. You will not be able to see it again!',
      },
      {},
      201
    );
  } catch (error) {
    return errorResponse(error);
  }
}

async function handleDELETE(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'apikey:revoke');
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) throw AppError.badRequest('Missing key id query parameter');

    await developerService.revokeApiKey(id, principal.workspaceId);
    return successResponse({ success: true, id, message: 'API key revoked successfully' });
  } catch (error) {
    return errorResponse(error);
  }
}

export const dynamic = 'force-dynamic';

export const GET = withApiRoute(handleGET, 'apikey:read');

export const POST = withApiRoute(handlePOST, 'apikey:create');

export const DELETE = withApiRoute(handleDELETE, 'apikey:revoke');
