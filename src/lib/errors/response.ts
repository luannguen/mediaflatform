import { NextResponse } from 'next/server';
import { AppError } from './app-error';
import { ErrorCodes } from './codes';
import { requestState } from '@/lib/platform/requestState';

export interface ApiResponseMeta {
  request_id?: string;
  timestamp?: string;
  pagination?: {
    total?: number;
    page?: number;
    limit?: number;
    offset?: number;
    has_more?: boolean;
    next_cursor?: string | null;
  };
  [key: string]: any;
}

export function successResponse<T>(
  data: T,
  meta: ApiResponseMeta = {},
  status: number = 200,
  customHeaders: Record<string, string> = {}
) {
  const reqId = meta.request_id || requestState.getStore()?.requestId || `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  return NextResponse.json(
    {
      success: true,
      data,
      meta: {
        request_id: reqId,
        timestamp: new Date().toISOString(),
        ...meta,
      },
    },
    {
      status,
      headers: {
        'X-Request-Id': reqId,
        ...customHeaders,
      },
    }
  );
}

export function errorResponse(
  error: unknown,
  requestId: string = requestState.getStore()?.requestId || `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
  customHeaders: Record<string, string> = {}
) {
  const headers = {
    'X-Request-Id': requestId,
    ...customHeaders,
  };

  if (error instanceof AppError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.statusCode >= 500 ? 'Service temporarily unavailable. Contact support with the request ID.' : error.message,
          request_id: requestId,
          ...(error.details && error.statusCode < 500 ? { details: error.details } : {}),
        },
      },
      {
        status: error.statusCode,
        headers,
      }
    );
  }

  const message = 'An unexpected error occurred. Contact support with the request ID.';
  console.error('[API_ERROR]', requestId, error instanceof Error ? error.name : 'UnknownError');

  return NextResponse.json(
    {
      success: false,
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message,
        request_id: requestId,
      },
    },
    {
      status: 500,
      headers,
    }
  );
}
