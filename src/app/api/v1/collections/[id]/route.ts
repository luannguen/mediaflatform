import { NextRequest } from 'next/server';
import { collectionService } from '@/services/collectionService';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const principal = await authenticateRequest(req, 'collections:read');
    const collection = await collectionService.getCollection(principal.workspaceId, id);
    return successResponse(collection);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const principal = await authenticateRequest(req, 'collections:write');
    await collectionService.deleteCollection(principal.workspaceId, id);
    return successResponse({ deleted: true, id });
  } catch (error) {
    return errorResponse(error);
  }
}
