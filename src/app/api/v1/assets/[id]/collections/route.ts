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
    const principal = await authenticateRequest(req, 'assets:read');
    const collections = await collectionService.getAssetCollections(principal.workspaceId, id);
    return successResponse(collections);
  } catch (error) {
    return errorResponse(error);
  }
}
