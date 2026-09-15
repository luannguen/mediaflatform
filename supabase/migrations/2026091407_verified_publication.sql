-- Require verified bytes and exact run identity at the final publication boundary.
CREATE OR REPLACE FUNCTION public.finalize_upload_session(p_session_id text, p_workspace_id text, p_caller_user_id text, p_caller_service_account_id text, p_actual_size_bytes bigint, p_declared_checksum text DEFAULT NULL::text, p_content_type text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
        v_status public.asset_status_enum := 'uploading';
        v_proc_status public.processing_status_enum := 'ready';
        v_job_type TEXT;
      BEGIN
        PERFORM id FROM public.workspaces WHERE id=p_workspace_id AND status='active' FOR UPDATE;
        IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error_code','WORKSPACE_ACCESS_DENIED'); END IF;
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

        IF v_session.requested_by_id IS DISTINCT FROM COALESCE(p_caller_service_account_id, p_caller_user_id) OR v_session.requested_by_type IS DISTINCT FROM (CASE WHEN p_caller_service_account_id IS NOT NULL THEN 'service_account' ELSE 'user' END) THEN
          RETURN jsonb_build_object('success', false, 'error_code', 'WORKSPACE_ACCESS_DENIED', 'message', 'Only the initiating identity can complete this upload');
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
        v_display_name := COALESCE(v_session.display_name, regexp_replace(v_filename, '\.[^/.]+$', ''));
        v_ext := lower(COALESCE(substring(v_filename from '\.([^\.]+)$'), ''));
        v_visibility := COALESCE(v_session.visibility, 'workspace')::public.visibility_enum;

        IF v_session.mime_type LIKE 'video/%' OR v_ext IN ('mp4', 'mov', 'webm', 'mkv', 'avi') THEN
          v_asset_type := 'video'; v_proc_status := 'pending'; v_job_type := 'video_transcode';
        ELSIF v_session.mime_type LIKE 'image/%' OR v_ext IN ('jpg', 'jpeg', 'png', 'webp', 'gif', 'svg') THEN
          v_asset_type := 'image'; v_proc_status := 'pending'; v_job_type := 'image_optimization';
        ELSIF v_session.mime_type = 'application/pdf' OR v_ext = 'pdf' THEN
          v_asset_type := 'document'; v_proc_status := 'pending'; v_job_type := 'document_extract';
        ELSIF v_session.mime_type LIKE '%zip%' OR v_session.mime_type LIKE '%tar%' OR v_ext IN ('zip', 'tar', 'gz') THEN
          v_asset_type := 'archive'; v_status := 'quarantined'; v_proc_status := 'ready'; v_job_type := NULL;
        ELSE
          v_asset_type := 'other'; v_status := 'quarantined'; v_proc_status := 'ready'; v_job_type := NULL;
        END IF;

        v_asset_id := COALESCE(v_session.reserved_asset_id, 'med_' || replace(gen_random_uuid()::text, '-', ''));
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
          v_session.mime_type,
          v_ext,
          p_actual_size_bytes,
          COALESCE(v_session.storage_provider, 'supabase'),
          COALESCE(v_session.storage_bucket, 'media-assets'),
          v_session.storage_key,
          NULL,
          'sha256',
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
            jsonb_build_object('original_filename', v_filename, 'mime_type', v_session.mime_type, 'size_bytes', p_actual_size_bytes),
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
      $function$;
CREATE OR REPLACE FUNCTION public.publish_processed_asset(p_job_id text, p_worker_id text, p_job_run_id text, p_output_version text, p_output_manifest jsonb, p_asset_metadata jsonb DEFAULT '{}'::jsonb, p_variants jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
      DECLARE
        v_job RECORD;
        v_now TIMESTAMPTZ := NOW();
        v_variant JSONB;
      BEGIN
        -- Fencing check: must match worker, run_id, active lease, and processing status
        SELECT * INTO v_job
        FROM processing_jobs
        WHERE id = p_job_id
          AND status = 'processing'
          AND locked_by = p_worker_id
          AND job_run_id = p_job_run_id
          AND lease_expires_at > v_now
        FOR UPDATE;

        IF NOT FOUND THEN
          RETURN jsonb_build_object('success', false, 'reason', 'LEASE_LOST');
        END IF;

        PERFORM id FROM public.assets WHERE id=v_job.asset_id AND status IN ('active','uploading') AND coalesce(metadata_json->>'purge_pending','false')<>'true' AND metadata_json->>'checksum_verified'='true' FOR UPDATE;
        IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'reason','ASSET_NOT_PROCESSABLE'); END IF;

        -- Update processing_jobs
        UPDATE processing_jobs
        SET
          status = 'completed',
          current_stage = 'ready',
          progress = 100,
          output_version = p_output_version,
          metadata_json = COALESCE(metadata_json, '{}'::jsonb) || jsonb_build_object('output_manifest', p_output_manifest),
          completed_at = v_now,
          locked_by = NULL,
          locked_at = NULL,
          lease_expires_at = NULL,
          updated_at = v_now
        WHERE id = p_job_id;

        -- Update assets
        UPDATE assets
        SET
          processing_status = 'ready',
          status = 'active',
          metadata_json = COALESCE(metadata_json, '{}'::jsonb) || p_asset_metadata || jsonb_build_object('active_output_version', p_output_version),
          updated_at = v_now
        WHERE id = v_job.asset_id;

        -- Upsert variants if provided
        IF p_variants IS NOT NULL AND jsonb_array_length(p_variants) > 0 THEN
          FOR v_variant IN SELECT * FROM jsonb_array_elements(p_variants) LOOP
            INSERT INTO asset_variants (
              id,
              asset_id,
              variant_name,
              output_version,
              storage_provider,
              storage_key,
              storage_url,
              mime_type,
              format,
              width,
              height,
              size_bytes,
              quality,
              status,
              created_at,
              updated_at
            ) VALUES (
              COALESCE(v_variant->>'id', 'var_' || substr(md5(random()::text || clock_timestamp()::text), 1, 20)),
              v_job.asset_id,
              v_variant->>'variant_name',
              p_output_version,
              COALESCE(v_variant->>'storage_provider', 'supabase'),
              v_variant->>'storage_key',
              v_variant->>'storage_url',
              COALESCE(v_variant->>'mime_type', 'image/webp'),
              v_variant->>'format',
              (v_variant->>'width')::int,
              (v_variant->>'height')::int,
              COALESCE((v_variant->>'size_bytes')::bigint, 0),
              COALESCE((v_variant->>'quality')::int, 80),
              'ready',
              v_now,
              v_now
            )
            ON CONFLICT (asset_id, variant_name, COALESCE(output_version, ''))
            DO UPDATE SET
              storage_key = EXCLUDED.storage_key,
              size_bytes = EXCLUDED.size_bytes,
              width = EXCLUDED.width,
              height = EXCLUDED.height,
              updated_at = v_now;
          END LOOP;
        END IF;

        RETURN jsonb_build_object('success', true, 'status', 'ready', 'output_version', p_output_version);
      END;
      $function$;
CREATE OR REPLACE FUNCTION public.publish_transcoded_asset(p_job_id text, p_worker_id text, p_job_run_id text, p_output_version text, p_output_manifest jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_asset_id TEXT;
  v_updated INT;
BEGIN
  SELECT asset_id INTO v_asset_id FROM processing_jobs WHERE id=p_job_id AND status='processing' AND locked_by=p_worker_id AND job_run_id=p_job_run_id AND lease_expires_at>now() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM id FROM assets WHERE id=v_asset_id AND status IN ('active','uploading') AND coalesce(metadata_json->>'purge_pending','false')<>'true' AND metadata_json->>'checksum_verified'='true' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  -- 1. Fenced update on processing_jobs
  UPDATE processing_jobs
  SET
    status = 'completed',
    current_stage = 'ready',
    progress = 100,
    output_version = p_output_version,
    completed_at = NOW(),
    heartbeat_at = NOW(),
    lease_expires_at = NULL,
    updated_at = NOW(),
    metadata_json = jsonb_set(COALESCE(metadata_json, '{}'::jsonb), '{output_manifest}', p_output_manifest)
  WHERE id = p_job_id
    AND status = 'processing'
    AND locked_by = p_worker_id
    AND lease_expires_at > NOW()
    AND job_run_id = p_job_run_id
  RETURNING asset_id INTO v_asset_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 OR v_asset_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- 2. Atomic publish to assets
  UPDATE assets
  SET
    processing_status = 'ready',
    status = 'active',
    metadata_json = jsonb_set(
      jsonb_set(COALESCE(metadata_json, '{}'::jsonb), '{active_output_version}', to_jsonb(p_output_version)),
      '{hls}',
      p_output_manifest
    ),
    updated_at = NOW()
  WHERE id = v_asset_id;

  RETURN TRUE;
END;
$function$;
CREATE OR REPLACE FUNCTION public.workspace_member_directory(p_workspace text) RETURNS jsonb LANGUAGE sql SET search_path=pg_catalog,public AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('user_email',u.email,'user_name',coalesce(u.raw_user_meta_data->>'full_name',split_part(u.email,'@',1)),'role',replace(m.role_id,'role_',''))),'[]'::jsonb)
 FROM public.workspace_memberships m LEFT JOIN auth.users u ON u.id::text=m.user_id WHERE m.workspace_id=p_workspace AND m.status='active';
$$;
REVOKE ALL ON FUNCTION public.workspace_member_directory(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_member_directory(text) TO service_role;
