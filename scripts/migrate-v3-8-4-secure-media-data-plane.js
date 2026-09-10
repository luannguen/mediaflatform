const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Parse .env.local safely
if (fs.existsSync('.env.local')) {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      let val = match[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[match[1].trim()] = val;
    }
  }
}

const isDryRun = process.argv.includes('--dry-run');

async function main() {
  console.log('============================================================');
  console.log('MEDIA PLATFORM v3.8.4 — SECURE MEDIA DATA PLANE MIGRATION');
  console.log(`Execution Mode: ${isDryRun ? 'DRY-RUN (No writes)' : 'APPLY (Live mutations)'}`);
  console.log('============================================================\n');

  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DIRECT_URL or DATABASE_URL environment variable is required');
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    await client.query('BEGIN');

    // 1. Schema Updates on upload_sessions
    console.log('1. Updating upload_sessions schema and constraints...');
    await client.query(`
      ALTER TABLE upload_sessions 
        ADD COLUMN IF NOT EXISTS storage_provider TEXT NOT NULL DEFAULT 'supabase',
        ADD COLUMN IF NOT EXISTS storage_bucket TEXT NOT NULL DEFAULT 'media-assets',
        ADD COLUMN IF NOT EXISTS folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS display_name TEXT,
        ADD COLUMN IF NOT EXISTS visibility visibility_enum NOT NULL DEFAULT 'workspace',
        ADD COLUMN IF NOT EXISTS metadata_json JSONB DEFAULT '{}'::jsonb;
    `);

    // Drop old status constraint and add updated status constraint
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE upload_sessions DROP CONSTRAINT IF EXISTS upload_sessions_status_check;
        ALTER TABLE upload_sessions ADD CONSTRAINT upload_sessions_status_check 
          CHECK (status IN ('created', 'uploading', 'uploaded', 'verifying', 'completed', 'expired_pending_cleanup', 'expired', 'failed', 'cancelled'));
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END $$;
    `);

    // Ensure unique index on upload_sessions(asset_id)
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_upload_sessions_asset 
      ON upload_sessions(asset_id) 
      WHERE asset_id IS NOT NULL;
    `);

    // Ensure uniqueness for initial processing jobs
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_processing_jobs_initial 
      ON processing_jobs(asset_id, job_type) 
      WHERE attempt = 1 AND current_stage = 'queued';
    `);

    console.log('✅ upload_sessions schema & indexes hardened.\n');

    // 2. Deploy Atomic finalize_upload_session RPC
    console.log('2. Deploying atomic finalize_upload_session RPC...');
    await client.query(`
      CREATE OR REPLACE FUNCTION finalize_upload_session(
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
        -- 1. Lock the upload_session row FOR UPDATE to prevent concurrency races
        SELECT * INTO v_session
        FROM public.upload_sessions
        WHERE id = p_session_id
        FOR UPDATE;

        IF NOT FOUND THEN
          RETURN jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_NOT_FOUND',
            'message', 'Upload session not found'
          );
        END IF;

        -- 2. Tenant isolation check
        IF v_session.workspace_id <> p_workspace_id THEN
          RETURN jsonb_build_object(
            'success', false,
            'error_code', 'WORKSPACE_ACCESS_DENIED',
            'message', 'Forbidden: session belongs to another workspace'
          );
        END IF;

        -- 3. Idempotency: If already completed, deterministically return existing Asset and Job
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

        -- 4. Check session status and expiration
        IF v_session.status NOT IN ('created', 'uploading', 'uploaded', 'verifying') THEN
          RETURN jsonb_build_object(
            'success', false,
            'error_code', 'INVALID_SESSION_STATUS',
            'message', 'Session is in ' || v_session.status || ' state'
          );
        END IF;

        IF v_session.expires_at <= v_now THEN
          UPDATE public.upload_sessions SET status = 'expired' WHERE id = p_session_id;
          RETURN jsonb_build_object(
            'success', false,
            'error_code', 'UPLOAD_SESSION_EXPIRED',
            'message', 'Upload session has expired'
          );
        END IF;

        -- 5. Determine asset properties
        v_filename := v_session.filename;
        v_display_name := COALESCE(v_session.display_name, regexp_replace(v_filename, '\.[^/.]+$', ''));
        v_ext := COALESCE(substring(v_filename from '\.([^\.]+)$'), '');
        v_visibility := COALESCE(v_session.visibility, 'workspace')::public.visibility_enum;

        -- Detect asset type
        IF COALESCE(p_content_type, v_session.mime_type) LIKE 'video/%' OR v_ext IN ('mp4', 'mov', 'webm', 'mkv', 'avi') THEN
          v_asset_type := 'video';
          v_proc_status := 'pending';
          v_job_type := 'video_transcode';
        ELSIF COALESCE(p_content_type, v_session.mime_type) LIKE 'image/%' OR v_ext IN ('jpg', 'jpeg', 'png', 'webp', 'gif', 'svg') THEN
          v_asset_type := 'image';
          v_proc_status := 'pending';
          v_job_type := 'image_optimization';
        ELSIF COALESCE(p_content_type, v_session.mime_type) = 'application/pdf' OR v_ext = 'pdf' THEN
          v_asset_type := 'document';
          v_proc_status := 'pending';
          v_job_type := 'document_extract';
        ELSIF COALESCE(p_content_type, v_session.mime_type) LIKE '%zip%' OR COALESCE(p_content_type, v_session.mime_type) LIKE '%tar%' OR v_ext IN ('zip', 'tar', 'gz') THEN
          v_asset_type := 'archive';
          v_status := 'quarantined';
          v_proc_status := 'ready';
          v_job_type := NULL;
        ELSE
          v_asset_type := 'other';
          v_proc_status := 'ready';
          v_job_type := NULL;
        END IF;

        -- 6. Atomic Create Asset
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
          'sha256',
          p_declared_checksum,
          v_visibility,
          v_status,
          v_proc_status,
          p_caller_user_id,
          p_caller_service_account_id,
          jsonb_build_object(
            'session_id', v_session.id,
            'declared_size', v_session.size_bytes,
            'actual_size', p_actual_size_bytes,
            'declared_checksum', p_declared_checksum,
            'finalized_at', v_now
          ),
          v_now,
          v_now
        );

        -- 7. Atomic update upload_sessions
        UPDATE public.upload_sessions
        SET status = 'completed',
            completed_at = v_now,
            asset_id = v_asset_id
        WHERE id = p_session_id;

        -- 8. Atomic Enqueue initial ProcessingJob if media processing is needed
        IF v_job_type IS NOT NULL THEN
          v_job_id := 'job_' || substr(md5(random()::text || clock_timestamp()::text), 1, 20);
          INSERT INTO public.processing_jobs (
            id, asset_id, workspace_id, job_type, status, current_stage, progress,
            source_storage_key, priority, attempt, max_attempts, metadata_json, created_at, updated_at
          ) VALUES (
            v_job_id,
            v_asset_id,
            v_session.workspace_id,
            v_job_type,
            'queued',
            'queued',
            0,
            v_session.storage_key,
            10,
            1,
            3,
            jsonb_build_object(
              'original_filename', v_filename,
              'mime_type', COALESCE(p_content_type, v_session.mime_type),
              'size_bytes', p_actual_size_bytes
            ),
            v_now,
            v_now
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

    // Privilege hardening for finalize_upload_session
    await client.query(`
      REVOKE ALL ON FUNCTION finalize_upload_session(TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
      GRANT EXECUTE ON FUNCTION finalize_upload_session(TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT) TO service_role, postgres;
    `);
    console.log('✅ finalize_upload_session RPC deployed with privilege hardening.\n');

    // 3. Patch fail_idempotency_key RPC
    console.log('3. Hardening fail_idempotency_key RPC with lease expiry check...');
    await client.query(`
      CREATE OR REPLACE FUNCTION fail_idempotency_key(
        p_workspace_id TEXT,
        p_idempotency_key TEXT,
        p_execution_token TEXT
      ) RETURNS JSONB AS $$
      DECLARE
        v_updated_rows INT;
      BEGIN
        UPDATE public.idempotency_records
        SET status = 'FAILED',
            updated_at = clock_timestamp()
        WHERE workspace_id = p_workspace_id
          AND idempotency_key = p_idempotency_key
          AND execution_token = p_execution_token
          AND status = 'PENDING'
          AND (lease_expires_at IS NULL OR lease_expires_at > clock_timestamp());

        GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

        IF v_updated_rows > 0 THEN
          RETURN jsonb_build_object('success', TRUE);
        ELSE
          RETURN jsonb_build_object('success', FALSE, 'reason', 'RESERVATION_LOST');
        END IF;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

      REVOKE ALL ON FUNCTION fail_idempotency_key(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
      GRANT EXECUTE ON FUNCTION fail_idempotency_key(TEXT, TEXT, TEXT) TO service_role, postgres;
    `);
    console.log('✅ fail_idempotency_key hardened.\n');

    // 4. Upgrade verify_platform_rpcs() with exact identity / signature inspection
    console.log('4. Upgrading verify_platform_rpcs() probe...');
    await client.query(`
      CREATE OR REPLACE FUNCTION verify_platform_rpcs()
      RETURNS JSONB AS $$
      DECLARE
        v_res JSONB;
      BEGIN
        SELECT jsonb_object_agg(name, status) INTO v_res
        FROM (
          SELECT r.rpc_name as name,
                 CASE
                   WHEN NOT EXISTS (
                     SELECT 1 FROM pg_proc p
                     JOIN pg_namespace n ON p.pronamespace = n.oid
                     WHERE n.nspname = 'public' AND p.proname = r.rpc_name
                   ) THEN 'missing'
                   WHEN EXISTS (
                     SELECT 1 FROM pg_proc p
                     JOIN pg_namespace n ON p.pronamespace = n.oid
                     WHERE n.nspname = 'public'
                       AND p.proname = r.rpc_name
                       AND p.pronargs = r.exact_args
                   ) THEN 'available'
                   ELSE 'signature_mismatch'
                 END as status
          FROM (VALUES
            ('claim_next_processing_job', 3),
            ('fail_processing_job', 8),
            ('publish_processed_asset', 7),
            ('consume_rate_limit_token', 3),
            ('reserve_idempotency_key', 8),
            ('complete_idempotency_key', 6),
            ('fail_idempotency_key', 3),
            ('renew_idempotency_lease', 4),
            ('finalize_upload_session', 7)
          ) AS r(rpc_name, exact_args)
        ) s;
        RETURN v_res;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public;

      REVOKE ALL ON FUNCTION verify_platform_rpcs() FROM PUBLIC, anon, authenticated;
      GRANT EXECUTE ON FUNCTION verify_platform_rpcs() TO service_role, postgres;
    `);
    console.log('✅ verify_platform_rpcs() upgraded.\n');

    // 5. Harden provision_workspace_for_user privileges
    console.log('5. Revoking public execution from provision_workspace_for_user...');
    await client.query(`
      DO $$ BEGIN
        REVOKE ALL ON FUNCTION provision_workspace_for_user(text, text, text, text, text, text, text, text, text, text, bigint, integer) FROM PUBLIC, anon, authenticated;
        GRANT EXECUTE ON FUNCTION provision_workspace_for_user(text, text, text, text, text, text, text, text, text, text, bigint, integer) TO service_role, postgres;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END $$;
    `);
    console.log('✅ provision_workspace_for_user execution hardened.\n');

    if (isDryRun) {
      await client.query('ROLLBACK');
      console.log('--- DRY-RUN COMPLETE (All changes rolled back) ---');
    } else {
      await client.query('COMMIT');
      console.log('=== MIGRATION COMMITTED SUCCESSFULLY ===');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration FAILED and ROLLED BACK:', err);
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
