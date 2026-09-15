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
    const principal = await authenticateRequest(req, 'jobs:heartbeat');
    const { id: jobId } = await params;

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const workerId = body.worker_id || principal.workerId || 'worker_external';
    const runId = body.run_id || undefined;
    const leaseSeconds = body.lease_seconds || 300;

    const renewed = await jobQueueService.renewHeartbeat(jobId, workerId, runId, leaseSeconds);
    if (!renewed) {
      throw AppError.badRequest('Lease renewal failed: Job is not processing or lease has been claimed by another worker');
    }

    return successResponse({
      job_id: jobId,
      renewed: true,
      worker_id: workerId,
      lease_seconds: leaseSeconds,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export const dynamic = 'force-dynamic';

export const POST = withApiRoute(handlePOST, 'jobs:heartbeat');
