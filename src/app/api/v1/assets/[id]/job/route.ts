import { withApiRoute } from '@/lib/platform/apiRoute';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { jobQueueService } from '@/services/jobQueueService';
import { AppError } from '@/lib/errors/app-error';

async function handleGET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const principal = await authenticateRequest(req, 'assets:read');
    const { id: assetId } = await params;

    const job = await jobQueueService.getJobByAssetId(assetId);
    if (!job || job.workspace_id !== principal.workspaceId) {
      return successResponse({ job: null, message: 'No processing job found for asset' });
    }

    return successResponse({ job });
  } catch (error) {
    return errorResponse(error);
  }
}

export const dynamic = 'force-dynamic';

export const GET = withApiRoute(handleGET, 'assets:read');
