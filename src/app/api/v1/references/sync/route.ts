import { NextRequest } from 'next/server';
import { referenceService } from '@/services/referenceService';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { AppError } from '@/lib/errors/app-error';

export async function POST(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'references:write');
    const body = await req.json();

    if (!body.source_app || !body.entity_type || !body.entity_id || !Array.isArray(body.references)) {
      throw AppError.badRequest('Payload must include source_app, entity_type, entity_id and references array');
    }

    const result = await referenceService.syncReferences({
      workspaceId: principal.workspaceId,
      sourceApp: body.source_app,
      entityType: body.entity_type,
      entityId: body.entity_id,
      references: body.references.map((r: any) => ({
        assetId: r.asset_id,
        fieldName: r.field_name,
        context: r.context,
      })),
    });

    return successResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}
