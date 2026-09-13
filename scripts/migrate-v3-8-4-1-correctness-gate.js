const fs = require('fs');
const { Client } = require('pg');

if (fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1].trim()] = value;
  }
}

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DIRECT_URL or DATABASE_URL is required');

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE OR REPLACE FUNCTION public.finalize_upload_session(
        p_session_id TEXT,
        p_workspace_id TEXT,
        p_caller_user_id TEXT,
        p_caller_service_account_id TEXT,
        p_actual_size_bytes BIGINT,
        p_declared_checksum TEXT DEFAULT NULL,
        p_content_type TEXT DEFAULT NULL
      )
      RETURNS JSONB
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $$
      DECLARE
        v_session RECORD;
        v_asset RECORD;
        v_job RECORD;
        v_asset_id TEXT;
        v_job_id TEXT;
        v_now TIMESTAMPTZ := clock_timestamp();
        v_asset_type public.asset_type_enum;
        v_ext TEXT;
        v_filename TEXT;
        v_display_name TEXT;
        v_visibility public.visibility_enum;
        v_status public.asset_status_enum := 'active';
        v_proc_status public.processing_status_enum := 'ready';
        v_job_type TEXT;
      BEGIN
        SELECT * INTO v_session
        FROM public.upload_sessions
        WHERE id = p_session_id
        FOR UPDATE;

        IF NOT FOUND THEN
          RETURN jsonb_build_object('success', false, 'error_code', 'SESSION_NOT_FOUND', 'message', 'Upload session not found');
        END IF;

        IF v_session.workspace_id <> p_workspace_id THEN
          RETURN jsonb_build_object('success', false, 'error_code', 'WORKSPACE_ACCESS_DENIED', 'message', 'Session belongs to another workspace');
        END IF;

        IF v_session.status = 'completed' AND v_session.asset_id IS NOT NULL THEN
          SELECT * INTO v_asset FROM public.assets WHERE id = v_session.asset_id;
          SELECT * INTO v_job FROM public.processing_jobs WHERE asset_id = v_session.asset_id ORDER BY created_at ASC LIMIT 1;
          RETURN jsonb_build_object(
            'success', true,
            'idempotent', true,
            'asset', to_jsonb(v_asset),
            'job', CASE WHEN v_job.id IS NOT NULL THEN to_jsonb(v_job) ELSE NULL END
          );
        END IF;

        IF v_session.status NOT IN ('created', 'uploading', 'uploaded', 'verifying') THEN
          RETURN jsonb_build_object('success', false, 'error_code', 'INVALID_SESSION_STATUS', 'message', 'Upload session state cannot be finalized');
        END IF;

        IF v_session.expires_at <= v_now THEN
          RETURN jsonb_build_object('success', false, 'error_code', 'UPLOAD_SESSION_EXPIRED', 'message', 'Upload session has expired');
        END IF;

        IF p_actual_size_bytes IS NULL OR p_actual_size_bytes <= 0 OR p_actual_size_bytes <> v_session.size_bytes THEN
          RETURN jsonb_build_object(
            'success', false,
            'error_code', 'UPLOAD_SIZE_MISMATCH',
            'message', 'Actual storage size does not match declared upload-session size',
            'declared_size_bytes', v_session.size_bytes,
            'actual_size_bytes', p_actual_size_bytes
          );
        END IF;

        IF v_session.folder_id IS NOT NULL AND NOT EXISTS (
          SELECT 1
          FROM public.folders f
          WHERE f.id = v_session.folder_id
            AND f.workspace_id = v_session.workspace_id
            AND f.deleted_at IS NULL
        ) THEN
          RETURN jsonb_build_object(
            'success', false,
            'error_code', 'FOLDER_WORKSPACE_MISMATCH',
            'message', 'Folder does not belong to the upload-session workspace'
          );
        END IF;

        v_filename := v_session.filename;
        v_display_name := COALESCE(v_session.display_name, regexp_replace(v_filename, '\\.[^/.]+$', ''));
        v_ext := lower(COALESCE(substring(v_filename from '\\.([^\\.]+)$'), ''));
        v_visibility := COALESCE(v_session.visibility, 'workspace')::public.visibility_enum;

        IF COALESCE(p_content_type, v_session.mime_type) LIKE 'video/%' OR v_ext IN ('mp4', 'mov', 'webm', 'mkv', 'avi') THEN
          v_asset_type := 'video'; v_proc_status := 'pending'; v_job_type := 'video_transcode';
        ELSIF COALESCE(p_content_type, v_session.mime_type) LIKE 'image/%' OR v_ext IN ('jpg', 'jpeg', 'png', 'webp', 'gif', 'svg') THEN
          v_asset_type := 'image'; v_proc_status := 'pending'; v_job_type := 'image_optimization';
        ELSIF COALESCE(p_content_type, v_session.mime_type) = 'application/pdf' OR v_ext = 'pdf' THEN
          v_asset_type := 'document'; v_proc_status := 'pending'; v_job_type := 'document_extract';
        ELSIF COALESCE(p_content_type, v_session.mime_type) LIKE '%zip%' OR COALESCE(p_content_type, v_session.mime_type) LIKE '%tar%' OR v_ext IN ('zip', 'tar', 'gz') THEN
          v_asset_type := 'archive'; v_status := 'quarantined'; v_proc_status := 'ready'; v_job_type := NULL;
        ELSE
          v_asset_type := 'other'; v_proc_status := 'ready'; v_job_type := NULL;
        END IF;

        v_asset_id := 'med_' || substr(md5(random()::text || clock_timestamp()::text), 1, 20);
        INSERT INTO public.assets (
          id, workspace_id, folder_id, asset_type, original_filename, display_name,
          mime_type, extension, size_bytes, storage_provider, storage_bucket,
          storage_key, storage_url, checksum_algorithm, checksum, visibility,
          status, processing_status, created_by_user_id, created_by_service_account_id,
          metadata_json, created_at, updated_at
        ) VALUES (
          v_asset_id,
          v_session.workspace_id,
          v_session.folder_id,
          v_asset_type,
          v_filename,
          v_display_name,
          COALESCE(p_content_type, v_session.mime_type),
          v_ext,
          p_actual_size_bytes,
          COALESCE(v_session.storage_provider, 'supabase'),
          COALESCE(v_session.storage_bucket, 'media-assets'),
          v_session.storage_key,
          NULL,
          NULL,
          NULL,
          v_visibility,
          v_status,
          v_proc_status,
          p_caller_user_id,
          p_caller_service_account_id,
          COALESCE(v_session.metadata_json, '{}'::jsonb) || jsonb_build_object(
            'session_id', v_session.id,
            'declared_size', v_session.size_bytes,
            'actual_size', p_actual_size_bytes,
            'declared_checksum', p_declared_checksum,
            'checksum_verified', false,
            'finalized_at', v_now
          ),
          v_now,
          v_now
        );

        UPDATE public.upload_sessions
        SET status = 'completed', completed_at = v_now, asset_id = v_asset_id
        WHERE id = p_session_id;

        IF v_job_type IS NOT NULL THEN
          v_job_id := 'job_' || substr(md5(random()::text || clock_timestamp()::text), 1, 20);
          INSERT INTO public.processing_jobs (
            id, asset_id, workspace_id, job_type, status, current_stage, progress,
            source_storage_key, priority, attempt, max_attempts, metadata_json, created_at, updated_at
          ) VALUES (
            v_job_id, v_asset_id, v_session.workspace_id, v_job_type, 'queued', 'queued', 0,
            v_session.storage_key, 10, 1, 3,
            jsonb_build_object('original_filename', v_filename, 'mime_type', COALESCE(p_content_type, v_session.mime_type), 'size_bytes', p_actual_size_bytes),
            v_now, v_now
          );
          SELECT * INTO v_job FROM public.processing_jobs WHERE id = v_job_id;
        END IF;

        SELECT * INTO v_asset FROM public.assets WHERE id = v_asset_id;
        RETURN jsonb_build_object(
          'success', true,
          'idempotent', false,
          'asset', to_jsonb(v_asset),
          'job', CASE WHEN v_job_id IS NOT NULL THEN to_jsonb(v_job) ELSE NULL END
        );
      END;
      $$;
    `);

    await client.query(`
      REVOKE ALL ON FUNCTION public.finalize_upload_session(TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT)
      FROM PUBLIC, anon, authenticated;
      GRANT EXECUTE ON FUNCTION public.finalize_upload_session(TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT)
      TO service_role, postgres;
    `);

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('v3.8.4.1 correctness migration validated and rolled back (--dry-run).');
    } else {
      await client.query('COMMIT');
      console.log('v3.8.4.1 correctness migration committed.');
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
