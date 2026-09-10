import { NextRequest } from 'next/server';
import { assetService } from '@/services/assetService';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { getStorageProvider } from '@/lib/storage/factory';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { AppError } from '@/lib/errors/app-error';
import { ErrorCodes } from '@/lib/errors/codes';
import crypto from 'crypto';
import sharp from 'sharp';
import { jobQueueService } from '@/services/jobQueueService';
import { ProcessingJob } from '@/types/database';

const MEDIA_MULTIPART_MAX_BYTES = 4 * 1024 * 1024; // 4MB limit for serverless multipart uploads

export async function POST(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'uploads:create');

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const folderId = (formData.get('folder_id') as string) || undefined;
    const displayName = (formData.get('display_name') as string) || undefined;
    const visibility = ((formData.get('visibility') as string) || 'workspace') as any;

    if (!file) {
      throw AppError.badRequest('No file provided in form data field "file"', ErrorCodes.VALIDATION_ERROR);
    }

    if (file.size > MEDIA_MULTIPART_MAX_BYTES) {
      throw new AppError(
        `Direct multipart upload is restricted to <= 4MB (received ${(file.size / 1024 / 1024).toFixed(1)}MB) to prevent serverless payload limits. Use direct upload sessions via POST /api/v1/uploads/sessions.`,
        ErrorCodes.DIRECT_UPLOAD_REQUIRED,
        413
      );
    }

    // Convert file to buffer and compute content checksum (SHA-256)
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

    // Section 19: Check for existing matching content (SHA-256 duplicate warning)
    const existingDuplicate = await assetService.checkDuplicate(checksum, principal.workspaceId);

    // Storage key: uploads/[workspace_id]/[timestamp]_[sanitized_filename]
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const storageKey = `uploads/${principal.workspaceId}/${Date.now()}_${sanitizedName}`;

    // Upload via Storage Provider abstraction
    const storage = getStorageProvider();
    let uploadedStorageKey: string | null = null;
    let assetCommitted = false;

    try {
      const uploadResult = await storage.upload(buffer, storageKey, file.type);
      uploadedStorageKey = uploadResult.storageKey;

      let width: number | null = null;
      let height: number | null = null;
      let metadata: Record<string, any> = {};

      if (file.type && file.type.startsWith('image/')) {
        try {
          const sharpInstance = sharp(buffer);
          const meta = await sharpInstance.metadata();
          width = meta.width || null;
          height = meta.height || null;

          const stats = await sharpInstance.stats();
          const r = Math.round(stats.channels[0]?.mean || 128);
          const g = Math.round(stats.channels[1]?.mean || 128);
          const b = Math.round(stats.channels[2]?.mean || 128);
          const toHex = (cr: number, cg: number, cb: number) =>
            `#${((1 << 24) + (Math.max(0, Math.min(255, cr)) << 16) + (Math.max(0, Math.min(255, cg)) << 8) + Math.max(0, Math.min(255, cb))).toString(16).slice(1)}`;

          const dominantHex = toHex(r, g, b);
          const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          metadata.palette = {
            dominant: dominantHex,
            colors: [
              dominantHex,
              toHex(r + 45, g + 45, b + 45),
              toHex(r - 45, g - 45, b - 45),
              toHex(Math.round(r * 1.25), Math.round(g * 0.75), Math.round(b * 1.15)),
              toHex(Math.round(r * 0.4 + 20), Math.round(g * 0.4 + 20), Math.round(b * 0.4 + 25)),
            ],
            is_dark: luminance < 0.5,
          };
        } catch (e) {
          // Non-fatal metadata extraction failure
        }
      }

      // Create Asset record in database
      const asset = await assetService.createAsset({
        workspaceId: principal.workspaceId,
        folderId: folderId || null,
        originalFilename: file.name,
        displayName: displayName || file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        width,
        height,
        storageKey: uploadResult.storageKey,
        storageUrl: uploadResult.storageUrl,
        checksum,
        visibility,
        createdByServiceAccountId: principal.serviceAccountId,
        metadata,
      });
      assetCommitted = true;

      let job: ProcessingJob | null = null;
      if (file.type && file.type.startsWith('video/')) {
        job = await jobQueueService.enqueueJob({
          assetId: asset.id,
          workspaceId: principal.workspaceId,
          jobType: 'video_transcode',
          sourceStorageKey: uploadResult.storageKey,
          sourceStorageUrl: uploadResult.storageUrl,
          priority: 10,
          metadata: {
            original_filename: file.name,
            mime_type: file.type,
            size_bytes: file.size,
          },
        });
      }

      return successResponse(
        {
          ...asset,
          ...(job ? { job_id: job.id, job_status: job.status } : {}),
        },
        {
          checksum,
          job_id: job?.id || null,
          duplicate_detected: Boolean(existingDuplicate),
          duplicate_of: existingDuplicate?.id || null,
          duplicate_warning: existingDuplicate
            ? `Warning: Content matches existing asset ${existingDuplicate.id} (${existingDuplicate.display_name})`
            : null,
        },
        201
      );
    } catch (pipelineError) {
      // Storage compensation: Only clean up uploaded storage object if asset insertion in DB was NOT committed
      if (uploadedStorageKey && !assetCommitted) {
        try {
          await storage.delete(uploadedStorageKey);
          console.log(`[UploadCompensation] Successfully compensated/deleted uncommitted storage object: ${uploadedStorageKey}`);
        } catch (cleanupError: any) {
          console.error(
            `[UploadCompensation] FAILED to delete orphaned storage object ${uploadedStorageKey}:`,
            cleanupError?.message || cleanupError
          );
        }
      }
      throw pipelineError;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
