import { NextRequest } from 'next/server';
import { referenceService } from '@/services/referenceService';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { AppError } from '@/lib/errors/app-error';

export async function POST(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'references:write');
    const body = await req.json();

    if (!body.asset_id || !body.source_app || !body.entity_type || !body.entity_id) {
      throw AppError.badRequest('Missing required fields: asset_id, source_app, entity_type, entity_id');
    }

    const ref = await referenceService.createReference({
      workspaceId: principal.workspaceId,
      assetId: body.asset_id,
      applicationId: principal.apiKeyId,
      sourceApp: body.source_app,
      entityType: body.entity_type,
      entityId: body.entity_id,
      fieldName: body.field_name,
      context: body.context,
    });

    return successResponse(ref, {}, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'references:write');
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) throw AppError.badRequest('Missing reference id in query parameter');

    await referenceService.deleteReference(id, principal.workspaceId);
    return successResponse({ success: true, id, message: 'Reference deleted' });
  } catch (error) {
    return errorResponse(error);
  }
}
