import { withApiRoute } from '@/lib/platform/apiRoute';
import { NextResponse } from 'next/server';
import { openApiSpec } from '@/openapi/spec';

export const dynamic = 'force-dynamic';

async function handleGET() {
  return NextResponse.json(openApiSpec, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Media-Api-Key',
    },
  });
}

export const GET = withApiRoute(handleGET);
