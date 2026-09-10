import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { extractRequestId } from '@/lib/platform/requestContext';
import { PLATFORM_VERSION, API_VERSION } from '@/lib/platform/version';
import { usageService } from '@/services/usageService';
import { errorResponse } from '@/lib/errors/response';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/developer/diagnostics
 * Authenticated Developer Diagnostics: Returns the caller's execution context, granted scopes,
 * quota, and environment without leaking any credentials or hashes.
 */
export async function GET(req: NextRequest) {
  const requestId = extractRequestId(req);
  try {
    const principal = await authenticateRequest(req);
    const usage = await usageService.getWorkspaceUsage(principal.workspaceId);

    const diagnostics = {
      api_version: API_VERSION,
      platform_version: PLATFORM_VERSION,
      request_id: requestId,
      principal: {
        type: principal.type,
        workspace_id: principal.workspaceId,
        user_id: principal.userId || null,
        service_account_id: principal.serviceAccountId || null,
        api_key_id: principal.apiKeyId || null,
        granted_scopes: principal.scopes || [],
      },
      environment: process.env.NODE_ENV || 'production',
      quota_summary: {
        storage_used_bytes: usage.storage.usedBytes,
        storage_limit_bytes: usage.storage.limitBytes,
        storage_usage_percent: usage.storage.usagePercent,
        asset_count_total: usage.assets.totalCount,
        asset_count_limit: usage.assets.limitCount,
        asset_usage_percent: usage.assets.usagePercent,
      },
      rate_limit_policy: {
        window_seconds: 60,
        standard_read_rpm: 120,
        standard_write_rpm: 60,
        standard_upload_rpm: 30,
      },
      status: 'active',
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(
      {
        success: true,
        data: diagnostics,
      },
      {
        status: 200,
        headers: {
          'X-Request-Id': requestId,
          'Cache-Control': 'private, no-cache, no-store, must-revalidate',
        },
      }
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
