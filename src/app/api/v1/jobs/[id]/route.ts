import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { jobQueueService } from '@/services/jobQueueService';
import { AppError } from '@/lib/errors/app-error';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const principal = await authenticateRequest(req, 'assets:read');
    const { id: jobId } = await params;

    const job = await jobQueueService.getJobById(jobId);
    if (!job || job.workspace_id !== principal.workspaceId) {
      throw AppError.notFound(`Processing job ${jobId} not found`);
    }

    return successResponse(job);
  } catch (error) {
    return errorResponse(error);
  }
}
