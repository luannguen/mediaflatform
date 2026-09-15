import { withApiRoute } from '@/lib/platform/apiRoute';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { jobQueueService } from '@/services/jobQueueService';

async function handleGET(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'assets:read');
    const { searchParams } = new URL(req.url);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));

    const deadLetterJobs = await jobQueueService.listDeadLetterJobs(principal.workspaceId, limit);

    return successResponse({
      total: deadLetterJobs.length,
      items: deadLetterJobs,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export const dynamic = 'force-dynamic';

export const GET = withApiRoute(handleGET, 'assets:read');
