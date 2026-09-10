import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { jobQueueService } from '@/services/jobQueueService';
import { AppError } from '@/lib/errors/app-error';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const principal = await authenticateRequest(req, 'jobs:fail');
    const { id: jobId } = await params;

    const existing = await jobQueueService.getJobById(jobId);
    if (!existing || existing.workspace_id !== principal.workspaceId) {
      throw AppError.notFound(`Processing job ${jobId} not found`);
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const {
      error_code: errorCode,
      error_message: errorMessage,
      retryable,
      error_details: errorDetails,
    } = body;

    const failedJob = await jobQueueService.failJob(
      jobId,
      errorCode || 'WORKER_FAILED',
      errorMessage || 'Job execution reported failure',
      retryable ?? true,
      errorDetails || {}
    );

    return successResponse({
      job: failedJob,
      status: failedJob.status,
      message: `Job ${jobId} marked as ${failedJob.status}`,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
