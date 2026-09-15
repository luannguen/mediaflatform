ALTER TABLE public.idempotency_records ADD COLUMN replay_blocked boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.reserve_idempotency_key(p_id text,p_workspace_id text,p_idempotency_key text,p_route text,p_method text,p_request_hash text,p_lease_seconds integer DEFAULT 60,p_ttl_hours integer DEFAULT 24)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.idempotency_records; token text:='idemrun_'||gen_random_uuid()::text; deadline timestamptz:=clock_timestamp()+make_interval(secs=>p_lease_seconds);
BEGIN
 INSERT INTO public.idempotency_records(id,workspace_id,idempotency_key,route,method,request_hash,status,execution_token,lease_expires_at,expires_at)
 VALUES(p_id,p_workspace_id,p_idempotency_key,p_route,p_method,p_request_hash,'PENDING',token,deadline,now()+make_interval(hours=>p_ttl_hours)) ON CONFLICT(workspace_id,idempotency_key) DO NOTHING;
 SELECT * INTO r FROM public.idempotency_records WHERE workspace_id=p_workspace_id AND idempotency_key=p_idempotency_key FOR UPDATE;
 IF r.id=p_id THEN RETURN jsonb_build_object('action','execute','execution_token',token,'lease_expires_at',deadline); END IF;
 IF r.replay_blocked AND r.status<>'COMPLETED' THEN
  RETURN jsonb_build_object('action','in_progress','error','Execution is active or its outcome requires reconciliation; do not retry with a new key');
 END IF;
 IF r.expires_at>now() THEN
  IF r.route<>p_route OR r.method<>p_method OR r.request_hash<>p_request_hash THEN RETURN jsonb_build_object('action','conflict','error','Idempotency key was reused with a different request'); END IF;
  IF r.status='COMPLETED' THEN RETURN jsonb_build_object('action','cached','response_status',r.response_status,'response_headers',r.response_headers,'response_body',r.response_body); END IF;
  IF r.status='PENDING' AND r.lease_expires_at>clock_timestamp() THEN RETURN jsonb_build_object('action','in_progress','error','Execution in progress'); END IF;
 END IF;
 UPDATE public.idempotency_records SET id=p_id,route=p_route,method=p_method,request_hash=p_request_hash,status='PENDING',execution_token=token,lease_expires_at=deadline,expires_at=now()+make_interval(hours=>p_ttl_hours),replay_blocked=false,response_status=NULL,response_headers='{}',response_body='{}',updated_at=now() WHERE workspace_id=p_workspace_id AND idempotency_key=p_idempotency_key;
 RETURN jsonb_build_object('action','execute','execution_token',token,'lease_expires_at',deadline);
END $$;

CREATE FUNCTION public.begin_idempotent_execution(p_workspace_id text,p_key text,p_token text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE public.idempotency_records SET replay_blocked=true WHERE workspace_id=p_workspace_id AND idempotency_key=p_key AND execution_token=p_token AND status='PENDING' AND lease_expires_at>clock_timestamp() AND NOT replay_blocked;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.begin_idempotent_execution(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_idempotent_execution(text,text,text) TO service_role;
-- A completed record can be replayed; a crashed in-flight execution requires
-- reconciliation rather than repeating an unknown external/business effect.
