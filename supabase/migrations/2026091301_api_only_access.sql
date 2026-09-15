-- API-only data access. Supabase Auth still authenticates users, while all
-- application data goes through tenant-authorized server routes.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'organizations','workspaces','roles','workspace_memberships','folders',
    'collections','tags','assets','asset_variants','asset_versions',
    'collection_assets','asset_tags','asset_favorites','upload_sessions',
    'processing_jobs','applications','service_accounts','api_keys',
    'asset_references','webhook_endpoints','webhook_deliveries','audit_events',
    'api_request_logs','usage_metrics','integrity_issues','worker_instances',
    'idempotency_records','rate_limit_buckets','operational_alerts'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated',table_name);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role',table_name);
  END LOOP;
END $$;

-- Include historical overloads: otherwise old unfenced RPCs remain callable.
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN SELECT p.oid::regprocedure AS signature FROM pg_proc p
    WHERE p.pronamespace='public'::regnamespace AND p.proname = ANY(ARRAY[
      'claim_next_processing_job','renew_job_heartbeat','publish_transcoded_asset',
      'publish_processed_asset','fail_processing_job','finalize_upload_session',
      'provision_workspace_for_user','sync_asset_references','reserve_idempotency_key',
      'complete_idempotency_key','fail_idempotency_key','renew_idempotency_lease',
      'consume_rate_limit_token','verify_platform_rpcs'
    ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',fn.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',fn.signature);
  END LOOP;
END $$;
