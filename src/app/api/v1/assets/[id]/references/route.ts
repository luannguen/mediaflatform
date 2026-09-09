import { NextRequest } from 'next/server';
import { referenceService } from '@/services/referenceService';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const principal = await authenticateRequest(req, 'references:read');
    const references = await referenceService.listByAsset(id, principal.workspaceId);
    return successResponse(references);
  } catch (error) {
    return errorResponse(error);
  }
}
