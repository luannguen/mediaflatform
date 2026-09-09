import { NextRequest } from 'next/server';
import { tagService } from '@/services/tagService';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { AppError } from '@/lib/errors/app-error';

export async function GET(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'assets:read');
    const tags = await tagService.listTags(principal.workspaceId);
    return successResponse(tags);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'assets:write');
    const body = await req.json();

    if (!body.name) throw AppError.badRequest('Tag name is required');

    const tag = await tagService.createTag(principal.workspaceId, body.name, body.description);
    return successResponse(tag, {}, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
