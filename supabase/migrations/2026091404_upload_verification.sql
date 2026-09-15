ALTER TABLE public.upload_sessions ADD COLUMN IF NOT EXISTS reserved_asset_id text DEFAULT ('med_' || replace(gen_random_uuid()::text, '-', ''));
CREATE UNIQUE INDEX IF NOT EXISTS upload_sessions_reserved_asset ON public.upload_sessions(reserved_asset_id);

CREATE OR REPLACE FUNCTION public.enforce_upload_reservation() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog,public AS $$
DECLARE w public.workspaces; used_bytes bigint; used_count bigint; reserved_bytes bigint; reserved_count bigint;
BEGIN
  SELECT * INTO w FROM public.workspaces WHERE id=NEW.workspace_id AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WORKSPACE_DISABLED'; END IF;
  IF NEW.size_bytes <= 0 OR NEW.size_bytes > (CASE WHEN NEW.mime_type LIKE 'video/%' THEN 524288000 WHEN NEW.mime_type LIKE 'image/%' THEN 26214400 ELSE 52428800 END) THEN RAISE EXCEPTION 'UPLOAD_TOO_LARGE'; END IF;
  SELECT coalesce(sum(size_bytes),0), count(*) INTO used_bytes,used_count FROM public.assets WHERE workspace_id=NEW.workspace_id AND status<>'deleted';
  SELECT coalesce(sum(size_bytes),0), count(*) INTO reserved_bytes,reserved_count FROM public.upload_sessions WHERE workspace_id=NEW.workspace_id AND status IN ('created','uploading','uploaded','verifying') AND expires_at>now() AND asset_id IS NULL;
  IF (w.quota_storage_bytes>0 AND used_bytes+reserved_bytes+NEW.size_bytes>w.quota_storage_bytes) OR (w.quota_asset_count>0 AND used_count+reserved_count+1>w.quota_asset_count) THEN RAISE EXCEPTION 'QUOTA_EXCEEDED'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enforce_upload_reservation ON public.upload_sessions;
CREATE TRIGGER enforce_upload_reservation BEFORE INSERT ON public.upload_sessions FOR EACH ROW EXECUTE FUNCTION public.enforce_upload_reservation();
REVOKE ALL ON FUNCTION public.enforce_upload_reservation() FROM PUBLIC,anon,authenticated;

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
          p_declared_checksum,
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
      $function$
;

CREATE OR REPLACE FUNCTION public.claim_processing_job_scoped(p_worker_id text, p_workspace_id text, p_lease_seconds integer DEFAULT 300, p_job_run_id text DEFAULT NULL::text)
 RETURNS SETOF processing_jobs
 LANGUAGE plpgsql
AS $function$
      DECLARE
        v_job_id TEXT;
        v_run_id TEXT;
      BEGIN
        v_run_id := COALESCE(p_job_run_id, 'run_' || substr(md5(random()::text), 1, 12));

        -- Select candidate job using FOR UPDATE SKIP LOCKED
        SELECT id INTO v_job_id
        FROM processing_jobs
        WHERE workspace_id = p_workspace_id AND EXISTS (SELECT 1 FROM public.assets a WHERE a.id=processing_jobs.asset_id AND a.status IN ('active','uploading') AND COALESCE(a.metadata_json->>'purge_pending','false') <> 'true') AND (
          (status IN ('queued', 'retrying') AND available_at <= NOW())
          OR
          (status = 'processing' AND lease_expires_at IS NOT NULL AND lease_expires_at < NOW())
        )
        ORDER BY priority DESC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1;

        IF v_job_id IS NULL THEN
          RETURN;
        END IF;

        -- Atomically update and return the claimed job
        RETURN QUERY
        UPDATE processing_jobs
        SET
          status = 'processing',
          current_stage = 'probing',
          locked_by = p_worker_id,
          locked_at = NOW(),
          heartbeat_at = NOW(),
          lease_expires_at = NOW() + (p_lease_seconds || ' seconds')::interval,
          job_run_id = v_run_id,
          started_at = COALESCE(started_at, NOW()),
          updated_at = NOW()
        WHERE id = v_job_id
        RETURNING *;
      END;
      $function$
;
REVOKE ALL ON FUNCTION public.claim_processing_job_scoped(text,text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_processing_job_scoped(text,text,integer,text) TO service_role;

CREATE OR REPLACE FUNCTION public.verify_job_source(p_job_id text,p_worker_id text,p_run_id text,p_checksum text) RETURNS boolean LANGUAGE plpgsql SET search_path = pg_catalog,public AS $$
DECLARE j public.processing_jobs;
BEGIN
  SELECT * INTO j FROM public.processing_jobs WHERE id=p_job_id AND status='processing' AND locked_by=p_worker_id AND job_run_id=p_run_id AND lease_expires_at>now() FOR UPDATE;
  IF NOT FOUND OR p_checksum !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
  UPDATE public.assets SET checksum=p_checksum,checksum_algorithm='sha256',metadata_json=coalesce(metadata_json,'{}'::jsonb)||jsonb_build_object('checksum_verified',true,'content_verified_at',now()) WHERE id=j.asset_id AND status IN ('uploading','active') AND coalesce(metadata_json->>'purge_pending','false')<>'true';
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.verify_job_source(text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verify_job_source(text,text,text,text) TO service_role;
