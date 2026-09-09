import { NextRequest } from 'next/server';
import { authenticateRequest } from '@/lib/security/auth-guard';
import { successResponse, errorResponse } from '@/lib/errors/response';
import { AppError } from '@/lib/errors/app-error';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { mockDb } from '@/lib/mock/store';
import { webhookService } from '@/services/webhookService';
import { Asset } from '@/types/database';
import sharp from 'sharp';
import { jobQueueService } from '@/services/jobQueueService';

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

    const now = new Date().toISOString();
    let width = body.width || asset.width || null;
    let height = body.height || asset.height || null;
    let sizeBytes = typeof body.size_bytes === 'number' ? body.size_bytes : asset.size_bytes;
    let checksum = body.checksum || asset.checksum;
    let palette: { dominant?: string; colors?: string[]; is_dark?: boolean } | undefined = undefined;

    // 2. If it's an image, inspect dimensions and extract palette if storage_url is reachable
    if (asset.asset_type === 'image' && asset.storage_url && (!width || !height)) {
      try {
        let buf: Buffer | null = null;
        if (asset.storage_url.startsWith('data:')) {
          const b64 = asset.storage_url.split(',')[1];
          buf = Buffer.from(b64, 'base64');
        } else {
          const fetchRes = await fetch(asset.storage_url);
          if (fetchRes.ok) {
            const ab = await fetchRes.arrayBuffer();
            buf = Buffer.from(ab);
          }
        }

        if (buf) {
          const metadata = await sharp(buf).metadata();
          width = metadata.width || width;
          height = metadata.height || height;
          if (!sizeBytes) sizeBytes = buf.length;

          // Extract 5-color dominant palette
          const stats = await sharp(buf).stats();
          const r = Math.round(stats.channels[0].mean);
          const g = Math.round(stats.channels[1].mean);
          const b = Math.round(stats.channels[2].mean);
          const toHex = (cr: number, cg: number, cb: number) =>
            `#${((1 << 24) + (Math.max(0, Math.min(255, cr)) << 16) + (Math.max(0, Math.min(255, cg)) << 8) + Math.max(0, Math.min(255, cb))).toString(16).slice(1)}`;

          const dominantHex = toHex(r, g, b);
          const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          const lightTint = toHex(r + 45, g + 45, b + 45);
          const darkShade = toHex(r - 45, g - 45, b - 45);
          const vibrantAccent = toHex(Math.round(r * 1.25), Math.round(g * 0.75), Math.round(b * 1.15));
          const mutedTone = toHex(Math.round(r * 0.4 + 20), Math.round(g * 0.4 + 20), Math.round(b * 0.4 + 25));

          palette = {
            dominant: dominantHex,
            colors: [dominantHex, lightTint, darkShade, vibrantAccent, mutedTone],
            is_dark: luminance < 0.5,
          };
        }
      } catch (e) {
        // Non-fatal, keep existing dimensions
      }
    }

    const updatedMetadata = {
      ...(asset.metadata_json || {}),
      confirmed_at: now,
      ...(palette ? { palette } : {}),
    };

    const processingStatus = asset.asset_type === 'video' ? 'pending' : 'ready';

    // 3. Update asset status to active
    if (isSupabaseAdminConfigured()) {
      const { data: updated, error } = await supabaseAdmin
        .from('assets')
        .update({
          status: 'active',
          processing_status: processingStatus,
          width,
          height,
          size_bytes: sizeBytes,
          checksum,
          metadata_json: updatedMetadata,
          updated_at: now,
        })
        .eq('id', assetId)
        .select()
        .single();

      if (error || !updated) {
        throw AppError.internal(`Failed to confirm upload: ${error?.message}`);
      }
      asset = updated as Asset;
    } else {
      asset.status = 'active';
      asset.processing_status = processingStatus;
      asset.width = width;
      asset.height = height;
      asset.size_bytes = sizeBytes;
      asset.checksum = checksum;
      asset.metadata_json = updatedMetadata;
      asset.updated_at = now;
    }

    // If video, ensure an asynchronous processing job is enqueued
    if (asset.asset_type === 'video') {
      const existingJob = await jobQueueService.getJobByAssetId(asset.id);
      if (!existingJob) {
        await jobQueueService.enqueueJob({
          assetId: asset.id,
          workspaceId: principal.workspaceId,
          jobType: 'video_transcode',
          sourceStorageKey: asset.storage_key,
          sourceStorageUrl: asset.storage_url,
          priority: 10,
          metadata: {
            original_filename: asset.original_filename,
            mime_type: asset.mime_type,
          },
        });
      }
    }

    // 4. Trigger Outbound Webhook: asset.created
    try {
      await webhookService.dispatchEvent(principal.workspaceId, 'asset.created', {
        asset_id: asset.id,
        filename: asset.original_filename,
        display_name: asset.display_name,
        mime_type: asset.mime_type,
        size_bytes: asset.size_bytes,
        storage_url: asset.storage_url,
        confirmed_direct_upload: true,
      });
    } catch {
      // Non-blocking
    }

    return successResponse(asset);
  } catch (error) {
    return errorResponse(error);
  }
}
