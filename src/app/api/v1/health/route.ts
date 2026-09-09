import { successResponse } from '@/lib/errors/response';

export async function GET() {
  return successResponse({
    status: 'healthy',
    version: '1.0.0',
    system: 'Antigravity Media Platform DAM',
    timestamp: new Date().toISOString(),
  });
}
