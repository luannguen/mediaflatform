import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { assetService } from '@/services/assetService';
import { jobQueueService } from '@/services/jobQueueService';
import { getStorageProvider } from '@/lib/storage/factory';
import { FFMPEG_PATH } from '@/lib/media/videoEngine';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const execFileAsync = promisify(execFile);

export async function POST(req: NextRequest) {
  const tempDir = path.join(process.cwd(), 'scratch', 'temp_demo_videos');
  const tempFilename = `sample_720p_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.mp4`;
  const tempFilePath = path.join(tempDir, tempFilename);

  try {
    const principal = await authenticateRequest(req, 'assets:write');

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Generate a 3-second 720p 30fps H.264 test pattern with 1kHz sine audio
    // This allows instant testing without having to upload a large multi-megabyte video file
    await execFileAsync(
      FFMPEG_PATH,
      [
        '-f', 'lavfi',
        '-i', 'testsrc=duration=3:size=1280x720:rate=30',
        '-f', 'lavfi',
        '-i', 'sine=frequency=1000:duration=3',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-shortest',
        '-y',
        tempFilePath,
      ],
      { timeout: 15000 }
    );

    if (!fs.existsSync(tempFilePath)) {
      throw new Error('Không thể tạo video mẫu qua FFmpeg engine');
    }

    const videoBuffer = fs.readFileSync(tempFilePath);
    const checksum = crypto.createHash('sha256').update(videoBuffer).digest('hex');
    const storageKey = `uploads/${principal.workspaceId}/${Date.now()}_demo-sample-720p.mp4`;
    const mimeType = 'video/mp4';

    const storage = getStorageProvider();
    const uploadResult = await storage.upload(videoBuffer, storageKey, mimeType);

    const displayName = `Demo Sample 720p (${new Date().toLocaleTimeString('vi-VN')})`;

    const asset = await assetService.createAsset({
      workspaceId: principal.workspaceId,
      folderId: null,
      originalFilename: 'demo-sample-720p.mp4',
      displayName,
      mimeType,
      sizeBytes: videoBuffer.length,
      width: 1280,
      height: 720,
      storageKey: uploadResult.storageKey,
      storageUrl: uploadResult.storageUrl,
      checksum,
      visibility: 'public',
      createdByServiceAccountId: principal.serviceAccountId,
      metadata: {
        demo_generated: true,
        resolution: '1280x720',
        fps: 30,
        codec: 'h264',
        duration_seconds: 3,
      },
    });

    const job = await jobQueueService.enqueueJob({
      assetId: asset.id,
      workspaceId: principal.workspaceId,
      jobType: 'video_transcode',
      sourceStorageKey: uploadResult.storageKey,
      sourceStorageUrl: uploadResult.storageUrl,
      priority: 15,
      metadata: {
        original_filename: 'demo-sample-720p.mp4',
        mime_type: mimeType,
        size_bytes: videoBuffer.length,
        is_demo: true,
      },
    });

    return successResponse(
      {
        ...asset,
        job_id: job.id,
        job_status: job.status,
      },
      {
        message: 'Video mẫu 720p đã được sinh và đưa vào hàng đợi xử lý',
        checksum,
        job_id: job.id,
      },
      201
    );
  } catch (error) {
    return errorResponse(error);
  } finally {
    // Clean up local temp file
    if (fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch {}
    }
  }
}
