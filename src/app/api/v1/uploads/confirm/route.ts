import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { AppError } from '@/lib/errors/app-error';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { mockDb } from '@/lib/mock/store';
import { webhookService } from '@/services/webhookService';
import { Asset, AssetStatus, ProcessingStatus } from '@/types/database';
import { jobQueueService } from '@/services/jobQueueService';
import { getStorageProvider } from '@/lib/storage/factory';
import { validateDeclaredVsDetectedMime } from '@/lib/media/magicByteValidator';
import { sanitizeSvg } from '@/lib/media/svgSanitizer';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  try {
    const principal = await authenticateRequest(req, 'uploads:create');
    const body = await req.json();

    const assetId = body.asset_id;
    if (!assetId) {
      throw AppError.badRequest('Field "asset_id" is required');
    }

    // 1. Fetch asset record
    let asset: Asset | null = null;
    if (isSupabaseAdminConfigured()) {
      const { data, error } = await supabaseAdmin
        .from('assets')
        .select('*')
        .eq('id', assetId)
        .eq('workspace_id', principal.workspaceId)
        .maybeSingle();

      if (error || !data) {
        throw AppError.notFound(`Asset ${assetId} not found in workspace`);
      }
      asset = data as Asset;
    } else {
      asset = mockDb.assets.find((a) => a.id === assetId && a.workspace_id === principal.workspaceId) || null;
      if (!asset) {
        throw AppError.notFound(`Asset ${assetId} not found in workspace`);
      }
    }

    // 2. Download and verify storage object
    const storage = getStorageProvider();
    let fileBuffer: Buffer | null = null;
    try {
      fileBuffer = await storage.download(asset.storage_key);
    } catch {
      fileBuffer = null;
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      throw AppError.badRequest('Uploaded file does not exist in storage bucket', 'UPLOAD_FILE_NOT_FOUND');
    }

    const realSizeBytes = fileBuffer.length;
    const realChecksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // 3. Binary Magic Byte Validation & Anti-Spoofing
    const detected = validateDeclaredVsDetectedMime(
      asset.mime_type,
      fileBuffer,
      asset.original_filename
    );

    // 4. Determine Asset Status & Quarantine Handling
    let assetStatus: AssetStatus = 'active';
    let processingStatus: ProcessingStatus = 'ready';

    if (detected.isQuarantined || detected.assetType === 'archive' || detected.detectedMime === 'application/x-executable') {
      assetStatus = 'quarantined';
      processingStatus = 'ready';
    } else if (detected.detectedMime === 'image/svg+xml') {
      // SVG Sanitization
      const rawSvg = fileBuffer.toString('utf8');
      const sanitizedSvg = sanitizeSvg(rawSvg);
      await storage.upload(Buffer.from(sanitizedSvg, 'utf8'), asset.storage_key, 'image/svg+xml');
      processingStatus = 'ready';
    }

    const now = new Date().toISOString();
    const updatedMetadata = {
      ...(asset.metadata_json || {}),
      confirmed_at: now,
      detected_mime: detected.detectedMime,
      detected_type: detected.assetType,
      is_quarantined: assetStatus === 'quarantined',
    };

    let enqueuedJob: any = null;

    // 5. Enqueue Unified Processing Job for non-quarantined media
    if (assetStatus !== 'quarantined') {
      if (asset.asset_type === 'video' || detected.assetType === 'video') {
        processingStatus = 'pending';
        enqueuedJob = await jobQueueService.enqueueJob({
          assetId: asset.id,
          workspaceId: principal.workspaceId,
          jobType: 'video_transcode',
          sourceStorageKey: asset.storage_key,
          sourceStorageUrl: asset.storage_url,
          priority: 10,
          metadata: {
            original_filename: asset.original_filename,
            mime_type: detected.detectedMime,
          },
        });
      } else if (asset.asset_type === 'image' || detected.assetType === 'image') {
        processingStatus = 'pending';
        enqueuedJob = await jobQueueService.enqueueJob({
          assetId: asset.id,
          workspaceId: principal.workspaceId,
          jobType: 'image_optimization',
          sourceStorageKey: asset.storage_key,
          sourceStorageUrl: asset.storage_url,
          priority: 10,
          metadata: {
            original_filename: asset.original_filename,
            mime_type: detected.detectedMime,
          },
        });
      } else if (
        (asset.asset_type === 'document' || detected.assetType === 'document') &&
        detected.detectedMime === 'application/pdf'
      ) {
        processingStatus = 'pending';
        enqueuedJob = await jobQueueService.enqueueJob({
          assetId: asset.id,
          workspaceId: principal.workspaceId,
          jobType: 'document_extract',
          sourceStorageKey: asset.storage_key,
          sourceStorageUrl: asset.storage_url,
          priority: 10,
          metadata: {
            original_filename: asset.original_filename,
            mime_type: detected.detectedMime,
          },
        });
      }
    }

    // 6. Update database record
    const updatePayload: Partial<Asset> = {
      status: assetStatus,
      processing_status: processingStatus,
      size_bytes: realSizeBytes,
      checksum: realChecksum,
      mime_type: detected.detectedMime,
      metadata_json: updatedMetadata,
      updated_at: now,
    };

    if (isSupabaseAdminConfigured()) {
      const { data: updated, error } = await supabaseAdmin
        .from('assets')
        .update(updatePayload)
        .eq('id', assetId)
        .select()
        .single();

      if (error || !updated) {
        throw AppError.internal(`Failed to confirm upload: ${error?.message}`);
      }
      asset = updated as Asset;
    } else {
      Object.assign(asset, updatePayload);
    }

    // 7. Trigger Outbound Webhook: asset.created
    try {
      await webhookService.dispatchEvent(principal.workspaceId, 'asset.created', {
        asset_id: asset.id,
        filename: asset.original_filename,
        display_name: asset.display_name,
        mime_type: asset.mime_type,
        size_bytes: asset.size_bytes,
        storage_url: asset.storage_url,
        status: asset.status,
        processing_status: asset.processing_status,
      });
    } catch {}

    return successResponse({
      ...asset,
      job_id: enqueuedJob?.id || null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
