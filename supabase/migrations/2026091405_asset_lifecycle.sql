CREATE OR REPLACE FUNCTION public.restore_media_asset(p_asset_id text,p_workspace_id text) RETURNS public.assets
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE a public.assets;
BEGIN
  SELECT * INTO a FROM public.assets WHERE id=p_asset_id AND workspace_id=p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ASSET_NOT_FOUND'; END IF;
  IF coalesce(a.metadata_json->>'purge_pending','false')='true' THEN RAISE EXCEPTION 'PURGE_IN_PROGRESS'; END IF;
  IF a.status='active' THEN RETURN a; END IF;
  IF a.status<>'trashed' THEN RAISE EXCEPTION 'INVALID_ASSET_STATE'; END IF;
  UPDATE public.assets SET status=CASE WHEN processing_status='ready' THEN 'active'::public.asset_status_enum ELSE 'uploading'::public.asset_status_enum END, deleted_at=NULL,purge_after=NULL,updated_at=now() WHERE id=a.id RETURNING * INTO a;
  RETURN a;
END $$;

CREATE OR REPLACE FUNCTION public.prepare_asset_purge(p_asset_id text,p_workspace_id text,p_force boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE a public.assets; wait_until timestamptz; had_worker boolean;
BEGIN
  -- Use the same jobs-before-assets lock order as fenced publication.
  PERFORM id FROM public.processing_jobs WHERE asset_id=p_asset_id ORDER BY id FOR UPDATE;
  SELECT * INTO a FROM public.assets WHERE id=p_asset_id AND workspace_id=p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('absent',true); END IF;
  IF NOT p_force AND EXISTS(SELECT 1 FROM public.asset_references WHERE asset_id=a.id) THEN RAISE EXCEPTION 'ASSET_IN_USE'; END IF;
  wait_until := (a.metadata_json->>'purge_not_before')::timestamptz;
  IF coalesce(a.metadata_json->>'purge_pending','false')<>'true' THEN
    SELECT EXISTS(SELECT 1 FROM public.processing_jobs WHERE asset_id=a.id AND status='processing') INTO had_worker;
    wait_until := now()+CASE WHEN had_worker THEN interval '5 minutes' ELSE interval '0 seconds' END;
    UPDATE public.assets SET status='trashed',deleted_at=coalesce(deleted_at,now()),metadata_json=coalesce(metadata_json,'{}'::jsonb)||jsonb_build_object('purge_pending',true,'purge_not_before',wait_until),updated_at=now() WHERE id=a.id RETURNING * INTO a;
    UPDATE public.processing_jobs SET status='cancelled',locked_by=NULL,lease_expires_at=NULL,job_run_id=NULL,updated_at=now() WHERE asset_id=a.id AND status IN ('queued','pending','processing','retrying');
  END IF;
  RETURN jsonb_build_object('asset',to_jsonb(a),'ready',now()>=wait_until);
END $$;

CREATE OR REPLACE FUNCTION public.finish_asset_purge(p_asset_id text,p_workspace_id text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE a public.assets; v bigint; vs bigint; r bigint; j bigint;
BEGIN
  SELECT * INTO a FROM public.assets WHERE id=p_asset_id AND workspace_id=p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('variants',0,'versions',0,'references',0,'jobs',0); END IF;
  IF coalesce(a.metadata_json->>'purge_pending','false')<>'true' OR (a.metadata_json->>'purge_not_before')::timestamptz>now() THEN RAISE EXCEPTION 'PURGE_NOT_PREPARED'; END IF;
  SELECT count(*) INTO v FROM public.asset_variants WHERE asset_id=a.id;
  SELECT count(*) INTO vs FROM public.asset_versions WHERE asset_id=a.id;
  SELECT count(*) INTO j FROM public.processing_jobs WHERE asset_id=a.id;
  DELETE FROM public.asset_references WHERE asset_id=a.id; GET DIAGNOSTICS r=ROW_COUNT;
  DELETE FROM public.integrity_issues WHERE asset_id=a.id;
  DELETE FROM public.assets WHERE id=a.id;
  RETURN jsonb_build_object('variants',v,'versions',vs,'references',r,'jobs',j);
END $$;

CREATE OR REPLACE FUNCTION public.guard_asset_reference() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE a public.assets;
BEGIN
  SELECT * INTO a FROM public.assets WHERE id=NEW.asset_id FOR UPDATE;
  IF NOT FOUND OR a.workspace_id<>NEW.workspace_id OR a.status IN ('deleted','quarantined') OR coalesce(a.metadata_json->>'purge_pending','false')='true' THEN RAISE EXCEPTION 'ASSET_REFERENCE_FORBIDDEN'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_asset_reference ON public.asset_references;
CREATE TRIGGER guard_asset_reference BEFORE INSERT OR UPDATE ON public.asset_references FOR EACH ROW EXECUTE FUNCTION public.guard_asset_reference();

REVOKE ALL ON FUNCTION public.restore_media_asset(text,text),public.prepare_asset_purge(text,text,boolean),public.finish_asset_purge(text,text),public.guard_asset_reference() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.restore_media_asset(text,text),public.prepare_asset_purge(text,text,boolean),public.finish_asset_purge(text,text) TO service_role;

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
          AND (p_job_run_id IS NULL OR job_run_id = p_job_run_id)
          AND lease_expires_at > v_now
        FOR UPDATE;

        IF NOT FOUND THEN
          RETURN jsonb_build_object('success', false, 'reason', 'LEASE_LOST');
        END IF;

        PERFORM id FROM public.assets WHERE id=v_job.asset_id AND status IN ('active','uploading') AND coalesce(metadata_json->>'purge_pending','false')<>'true' FOR UPDATE;
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
      $function$
;

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
  PERFORM id FROM assets WHERE id=v_asset_id AND status IN ('active','uploading') AND coalesce(metadata_json->>'purge_pending','false')<>'true' FOR UPDATE;
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
    AND (p_job_run_id IS NULL OR job_run_id = p_job_run_id)
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
$function$
;
