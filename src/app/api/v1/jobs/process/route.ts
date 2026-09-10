import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { videoWorkerService } from '@/services/videoWorkerService';
import { AppError } from '@/lib/errors/app-error';

export async function POST(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'jobs:process');

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const workerId = body.worker_id || principal.workerId || 'worker_http';

    // Strictly enforce atomic claiming: Never allow direct bypass of claim_next_processing_job
    const processedJob = await videoWorkerService.processNextQueuedJob(workerId);

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
