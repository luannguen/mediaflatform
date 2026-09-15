ALTER TABLE public.webhook_deliveries ADD COLUMN IF NOT EXISTS lease_token text;
ALTER TABLE public.webhook_deliveries ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
CREATE INDEX IF NOT EXISTS webhook_dispatch_queue ON public.webhook_deliveries(next_attempt_at,created_at) WHERE status='pending';

CREATE OR REPLACE FUNCTION public.enqueue_media_event(p_workspace text,p_type text,p_data jsonb,p_event_id text) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  INSERT INTO public.webhook_deliveries(id,webhook_endpoint_id,event_type,event_id,payload,status,attempt_count,next_attempt_at)
  SELECT 'evt_'||replace(gen_random_uuid()::text,'-',''),e.id,p_type,p_event_id,jsonb_build_object('event_id',p_event_id,'event_type',p_type,'created_at',now(),'data',p_data),'pending',0,now()
  FROM public.webhook_endpoints e WHERE workspace_id=p_workspace AND status='active' AND (p_type=ANY(events) OR '*'=ANY(events));
END $$;

CREATE OR REPLACE FUNCTION public.capture_asset_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE a public.assets; kinds text[]; kind text;
BEGIN
  IF TG_OP='DELETE' THEN a:=OLD; kinds:=ARRAY['asset.deleted'];
  ELSIF TG_OP='INSERT' THEN a:=NEW; kinds:=ARRAY['asset.created'];
  ELSE
    a:=NEW;
    IF NEW.status='trashed' AND OLD.status<>'trashed' THEN kinds:=ARRAY['asset.trashed'];
    ELSIF OLD.status='trashed' AND NEW.status IN ('active','uploading') THEN kinds:=ARRAY['asset.restored'];
    ELSIF NEW.processing_status='ready' AND NEW.status='active' AND (OLD.processing_status<>'ready' OR OLD.metadata_json->>'active_output_version' IS DISTINCT FROM NEW.metadata_json->>'active_output_version') THEN kinds:=ARRAY[NEW.asset_type::text||'.processed'];
    ELSE kinds:=ARRAY['asset.updated']; END IF;
  END IF;
  FOREACH kind IN ARRAY kinds LOOP
    PERFORM public.enqueue_media_event(a.workspace_id,kind,jsonb_build_object('asset_id',a.id,'workspace_id',a.workspace_id,'status',a.status,'processing_status',a.processing_status,'display_name',a.display_name,'mime_type',a.mime_type,'output_version',a.metadata_json->>'active_output_version'),'event_'||gen_random_uuid()::text);
  END LOOP;
  RETURN coalesce(NEW,OLD);
END $$;
DROP TRIGGER IF EXISTS capture_asset_event ON public.assets;
CREATE TRIGGER capture_asset_event AFTER INSERT OR UPDATE OR DELETE ON public.assets FOR EACH ROW EXECUTE FUNCTION public.capture_asset_event();

CREATE OR REPLACE FUNCTION public.claim_webhook_delivery(p_workspace text DEFAULT NULL) RETURNS SETOF public.webhook_deliveries LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE chosen text;
BEGIN
  SELECT d.id INTO chosen FROM public.webhook_deliveries d JOIN public.webhook_endpoints e ON e.id=d.webhook_endpoint_id
  WHERE d.status='pending' AND e.status='active' AND (p_workspace IS NULL OR e.workspace_id=p_workspace)
    AND coalesce(d.next_attempt_at,d.created_at)<=now() AND (d.lease_expires_at IS NULL OR d.lease_expires_at<now())
  ORDER BY d.created_at FOR UPDATE OF d SKIP LOCKED LIMIT 1;
  IF chosen IS NULL THEN RETURN; END IF;
  RETURN QUERY UPDATE public.webhook_deliveries SET lease_token=gen_random_uuid()::text,lease_expires_at=now()+interval '60 seconds',attempt_count=attempt_count+1,last_attempt_at=now() WHERE id=chosen RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_media_event(text,text,jsonb,text),public.capture_asset_event(),public.claim_webhook_delivery(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_media_event(text,text,jsonb,text),public.claim_webhook_delivery(text) TO service_role;
