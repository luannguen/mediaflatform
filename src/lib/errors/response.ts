import { NextResponse } from 'next/server';
import { AppError } from './app-error';
import { ErrorCodes } from './codes';

export interface ApiResponseMeta {
  request_id?: string;
  timestamp?: string;
  pagination?: {
    total?: number;
    page?: number;
    limit?: number;
    has_more?: boolean;
    next_cursor?: string | null;
  };
  [key: string]: any;
}

export function successResponse<T>(data: T, meta: ApiResponseMeta = {}, status: number = 200) {
  return NextResponse.json(
    {
      success: true,
      data,
      meta: {
        timestamp: new Date().toISOString(),
        ...meta,
      },
    },
    { status }
  );
}

export function errorResponse(error: unknown, requestId: string = `req_${Date.now().toString(36)}`) {
  if (error instanceof AppError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          request_id: requestId,
          ...(error.details ? { details: error.details } : {}),
        },
      },
      { status: error.statusCode }
    );
  }

  const message = error instanceof Error ? error.message : 'An unexpected error occurred';
  console.error('[API_ERROR]', requestId, error);

  return NextResponse.json(
    {
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message,
        request_id: requestId,
      },
    },
    { status: 500 }
  );
}
