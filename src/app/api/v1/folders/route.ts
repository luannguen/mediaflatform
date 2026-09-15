import { withApiRoute } from '@/lib/platform/apiRoute';
import { NextRequest } from 'next/server';
import { folderService } from '@/services/folderService';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { AppError } from '@/lib/errors/app-error';

async function handleGET(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'folders:read');
    const { searchParams } = new URL(req.url);
    const parentId = searchParams.get('parent_id') || undefined;

    const folders = await folderService.listFolders(principal.workspaceId, parentId);
    return successResponse(folders);
  } catch (error) {
    return errorResponse(error);
  }
}

async function handlePOST(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'folders:write');
    const body = await req.json();

    if (!body.name) throw AppError.badRequest('Folder name is required');

    const folder = await folderService.createFolder(principal.workspaceId, body.name, body.parent_folder_id);
    return successResponse(folder, {}, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export const dynamic = 'force-dynamic';

export const GET = withApiRoute(handleGET, 'folders:read');

export const POST = withApiRoute(handlePOST, 'folders:write');
