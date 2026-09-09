import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { videoWorkerService } from '@/services/videoWorkerService';
import { AppError } from '@/lib/errors/app-error';

export async function POST(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'assets:write');

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const { job_id: jobId, worker_id: workerId } = body;

    let processedJob = null;
    if (jobId) {
      processedJob = await videoWorkerService.processJob(jobId, workerId || 'worker_http');
    } else {
      processedJob = await videoWorkerService.processNextQueuedJob(workerId || 'worker_http');
    }

    if (!processedJob) {
      return successResponse({
        message: 'No queued processing jobs pending in queue',
        job: null,
      });
    }

    return successResponse({
      message: `Job ${processedJob.id} processed successfully`,
      job: processedJob,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
