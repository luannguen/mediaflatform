import { withApiRoute } from '@/lib/platform/apiRoute';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { jobQueueService } from '@/services/jobQueueService';

async function handleGET(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'assets:read');
    const metrics = await jobQueueService.getQueueMetrics(principal.workspaceId);

    return successResponse(metrics);
  } catch (error) {
    return errorResponse(error);
  }
}

export const dynamic = 'force-dynamic';

export const GET = withApiRoute(handleGET, 'assets:read');
