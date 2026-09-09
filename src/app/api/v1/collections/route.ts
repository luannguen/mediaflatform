import { NextRequest } from 'next/server';
import { collectionService } from '@/services/collectionService';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { AppError } from '@/lib/errors/app-error';

export async function GET(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'collections:read');
    const collections = await collectionService.listCollections(principal.workspaceId);
    return successResponse(collections);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'collections:write');
    const body = await req.json();

    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
      throw AppError.badRequest('Collection name is required');
    }

    const collection = await collectionService.createCollection(
      principal.workspaceId,
      body.name.trim(),
      body.description?.trim()
    );

    return successResponse(collection, {}, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
