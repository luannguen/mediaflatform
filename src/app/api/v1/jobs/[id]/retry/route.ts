import { withApiRoute } from '@/lib/platform/apiRoute';
import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { jobQueueService } from '@/services/jobQueueService';
import { AppError } from '@/lib/errors/app-error';

async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const principal = await authenticateRequest(req, 'assets:write');
    const { id: jobId } = await params;

    const existing = await jobQueueService.getJobById(jobId);
    if (!existing || existing.workspace_id !== principal.workspaceId) {
      throw AppError.notFound(`Processing job ${jobId} not found`);
    }

    let resetAttempts = false;
    try {
      const body = await req.json();
      if (body && typeof body.reset_attempts === 'boolean') {
        resetAttempts = body.reset_attempts;
      }
    } catch {
      // Optional body
    }

    const retriedJob = await jobQueueService.retryJob(jobId, resetAttempts);

    return successResponse({
      message: `Job ${jobId} reset to queued for retry attempt ${retriedJob.attempt}`,
      job: retriedJob,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export const dynamic = 'force-dynamic';

export const POST = withApiRoute(handlePOST, 'assets:write');
