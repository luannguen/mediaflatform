import { withApiRoute } from '@/lib/platform/apiRoute';
import { NextRequest } from 'next/server';
import { developerService } from '@/services/developerService';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { AppError } from '@/lib/errors/app-error';

async function handleGET(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'application:read');
    const apps = await developerService.listApplications(principal.workspaceId);
    const serviceAccounts = await developerService.listServiceAccounts(principal.workspaceId);

    return successResponse({
      applications: apps,
      serviceAccounts,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

async function handlePOST(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'application:manage');
    const body = await req.json();

    if (!body.name) throw AppError.badRequest('Application name is required');

    const app = await developerService.createApplication(principal.workspaceId, {
      name: body.name,
      slug: body.slug,
      description: body.description,
      environment: body.environment || 'production',
    });

    // Automatically create a default service account for this app
    const svc = await developerService.createServiceAccount(
      principal.workspaceId,
      app.id,
      `${app.slug}-default-service`,
      `Default service account for ${app.name}`
    );

    return successResponse({ application: app, serviceAccount: svc }, {}, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export const dynamic = 'force-dynamic';

export const GET = withApiRoute(handleGET, 'application:read');

export const POST = withApiRoute(handlePOST, 'application:manage');
