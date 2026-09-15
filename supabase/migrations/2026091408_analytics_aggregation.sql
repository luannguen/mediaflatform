-- Aggregate the complete reporting window in PostgreSQL instead of truncating at the REST row limit.
CREATE INDEX IF NOT EXISTS usage_metrics_workspace_time_idx ON public.usage_metrics(workspace_id, created_at DESC);
CREATE OR REPLACE FUNCTION public.workspace_media_analytics(p_workspace text, p_since timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
WITH events AS MATERIALIZED (
  SELECT * FROM public.usage_metrics
  WHERE workspace_id=p_workspace AND created_at >= greatest(p_since, now()-interval '30 days') AND created_at <= now()
), totals AS (
  SELECT count(*) AS requests, count(*) FILTER (WHERE event_type='cache_hit') AS hits,
    coalesce(sum(bytes_transferred),0) AS transferred, coalesce(sum(bytes_saved),0) AS saved,
    coalesce(round(avg(latency_ms)),0) AS latency FROM events
), formats AS (
  SELECT lower(coalesce(format,'unknown')) AS format, count(*) AS count, sum(bytes_transferred) AS bytes
  FROM events GROUP BY 1
), ranked AS (
  SELECT asset_id, count(*) AS requests, sum(bytes_transferred) AS bytes FROM events
  WHERE asset_id IS NOT NULL GROUP BY asset_id ORDER BY requests DESC, asset_id LIMIT 10
), recent AS (SELECT * FROM events ORDER BY created_at DESC, id DESC LIMIT 20)
SELECT jsonb_build_object(
  'totalRequests', requests, 'cacheHits', hits, 'cacheMisses', requests-hits,
  'cacheHitRate', CASE WHEN requests>0 THEN round(100.0*hits/requests,1) ELSE 0 END,
  'totalBytesTransferred', transferred, 'totalBytesSaved', saved,
  'bandwidthSavedPercent', CASE WHEN transferred+saved>0 THEN round(100.0*saved/(transferred+saved),1) ELSE 0 END,
  'avgLatencyMs', latency,
  'formatBreakdown', coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.count DESC,f.format) FROM formats f),'[]'::jsonb),
  'topAssets', coalesce((SELECT jsonb_agg(jsonb_build_object(
    'assetId',r.asset_id,'displayName',coalesce(a.display_name,r.asset_id),'mimeType',coalesce(a.mime_type,'application/octet-stream'),
    'requestsCount',r.requests,'bytesTransferred',r.bytes,
    'storageUrl',CASE WHEN a.id IS NOT NULL THEN '/api/v1/delivery/'||a.id||'?w=160' ELSE NULL END
  ) ORDER BY r.requests DESC,r.asset_id) FROM ranked r LEFT JOIN public.assets a ON a.id=r.asset_id AND a.workspace_id=p_workspace),'[]'::jsonb),
  'recentEvents',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id',id,'assetId',asset_id,'eventType',event_type,'bytesTransferred',bytes_transferred,
    'bytesSaved',bytes_saved,'format',format,'latencyMs',latency_ms,'createdAt',created_at
  ) ORDER BY created_at DESC,id DESC) FROM recent),'[]'::jsonb)
) FROM totals;
$$;
REVOKE ALL ON FUNCTION public.workspace_media_analytics(text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_media_analytics(text,timestamptz) TO service_role;
