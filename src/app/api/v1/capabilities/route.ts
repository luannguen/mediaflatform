import { NextResponse } from 'next/server';
import { PLATFORM_VERSION, API_VERSION, BUILD_DATE } from '@/lib/platform/version';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/capabilities
 * Machine-readable platform capabilities discovery endpoint.
 */
export async function GET() {
  const capabilities = {
    api_version: API_VERSION,
    platform_version: PLATFORM_VERSION,
    build_date: BUILD_DATE,
    processors: {
      image: {
        enabled: true,
        engine: 'sharp',
        input_formats: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml'],
        output_formats: ['webp', 'jpeg', 'png', 'avif'],
        canonical_variants: ['thumb', 'small', 'medium', 'large', 'xlarge'],
        max_dimension: 4096,
        max_megapixels: 16,
        features: ['auto_orient', 'strip_exif_gps', 'dominant_palette', 'deterministic_cache', 'smart_crop'],
      },
      video: {
        enabled: true,
        engine: 'ffmpeg',
        input_formats: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'],
        hls_ladder: ['360p', '480p', '720p', '1080p'],
        target_fps: 30,
        segment_duration_seconds: 4,
        features: ['hls_adaptive', 'smart_poster_frame', 'animated_trailer_webp', 'non_upscaling'],
      },
      document: {
        enabled: true,
        engine: 'pdf-lib',
        input_formats: ['application/pdf'],
        features: ['binary_validation', 'page_count_extraction', 'first_page_thumbnail_webp'],
      },
      audio: { enabled: false },
    },
    features: {
      direct_upload: true,
      direct_upload_protocols: ['signed-put'],
      resumable_upload: false,
      presigned_upload: true,
      private_delivery: true,
      magic_byte_validation: true,
      archive_quarantine: true,
      entity_references_sync: true,
      safe_delete_protection: true,
      artifact_graph_purge: true,
      webhooks: true,
      webhook_replay: true,
      api_key_rotation: true,
      rate_limiting: true,
      idempotency: true,
    },
    limits: {
      max_upload_size_bytes: 524288000,
      rate_limit_window_seconds: 60,
      presigned_url_expiration_seconds: 3600,
    },
  };

  return NextResponse.json(
    { success: true, data: capabilities },
    {
      status: 200,
      headers: { 'Cache-Control': 'public, max-age=300' },
    }
  );
}
