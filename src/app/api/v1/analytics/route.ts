import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { analyticsService } from '@/services/analyticsService';
import { successResponse, errorResponse } from '@/lib/errors/response';

export async function GET(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'analytics:read');
    const { searchParams } = new URL(req.url);
    const rawPeriod = searchParams.get('period');
    const period = (rawPeriod === '7d' || rawPeriod === '30d' ? rawPeriod : '24h') as '24h' | '7d' | '30d';

    const analytics = await analyticsService.getWorkspaceAnalytics(
      principal.workspaceId,
      period
    );

    return successResponse(analytics);
  } catch (error) {
    return errorResponse(error);
  }
}
