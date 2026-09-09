import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { jobQueueService } from '@/services/jobQueueService';

export async function GET(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'assets:read');
    const metrics = await jobQueueService.getQueueMetrics(principal.workspaceId);

    return successResponse(metrics);
  } catch (error) {
    return errorResponse(error);
  }
}
