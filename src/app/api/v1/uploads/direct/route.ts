import { NextRequest } from 'next/server';
import { POST as handleUpload } from '../route';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/uploads/direct
 * Canonical alias for direct multipart uploads forwarding to /api/v1/uploads
 */
export async function POST(req: NextRequest) {
  return handleUpload(req);
}
