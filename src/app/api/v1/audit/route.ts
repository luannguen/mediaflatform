import { NextRequest } from 'next/server';
import { auditService } from '@/services/auditService';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';

export async function GET(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'audit:read');
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const logs = await auditService.list(principal.workspaceId, limit);
    return successResponse(logs);
  } catch (error) {
    return errorResponse(error);
  }
}
