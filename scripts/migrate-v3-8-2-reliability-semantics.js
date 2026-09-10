/**
 * Database Migration: v3.8.2 Reliability Semantics Gate
 * 1. Fenced Idempotency State Machine (execution_token, lease_expires_at, updated_at)
 * 2. Atomic Fenced Idempotency RPCs (reserve, complete, fail, renew)
 * 3. Atomic Rate Limiter with search_path = public
 * 4. Critical RPC Registry & Signature Verification Probe
 * 5. Security & Privilege Hardening (search_path, revoke public execute)
 */

const fs = require('fs');
const { Client } = require('pg');

// 1. Load environment variables
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

async function runMigration() {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('❌ DIRECT_URL or DATABASE_URL is not configured.');
    process.exit(1);
  }

  console.log('Connecting to Supabase PostgreSQL for v3.8.2 migration...');
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log('Connected successfully!\n');

  try {
    // 1. Schema update for idempotency_records
    console.log('1. Upgrading idempotency_records schema (execution_token, lease_expires_at, updated_at)...');
    await client.query(`
      ALTER TABLE idempotency_records ADD COLUMN IF NOT EXISTS execution_token TEXT;
      ALTER TABLE idempotency_records ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
      ALTER TABLE idempotency_records ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT clock_timestamp();

      -- Migration safety: initialize lease for legacy pending records
      UPDATE idempotency_records
      SET lease_expires_at = created_at + INTERVAL '60 seconds'
      WHERE status = 'PENDING' AND lease_expires_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_idempotency_lease ON idempotency_records(lease_expires_at);
      CREATE INDEX IF NOT EXISTS idx_idempotency_token ON idempotency_records(execution_token);
    `);
    console.log('✅ idempotency_records schema upgraded.\n');

    // 2. Atomic Fenced Idempotency Reservation RPC
    console.log('2. Creating fenced reserve_idempotency_key RPC with lease...');
    await client.query(`
      CREATE OR REPLACE FUNCTION reserve_idempotency_key(
        p_id TEXT,
        p_workspace_id TEXT,
        p_idempotency_key TEXT,
        p_route TEXT,
        p_method TEXT,
        p_request_hash TEXT,
        p_lease_seconds INT DEFAULT 60,
        p_ttl_hours INT DEFAULT 24
      ) RETURNS JSONB AS $$
      DECLARE
        v_now TIMESTAMPTZ := clock_timestamp();
        v_lease_expires_at TIMESTAMPTZ := v_now + (p_lease_seconds || ' seconds')::INTERVAL;
        v_expires_at TIMESTAMPTZ := v_now + (p_ttl_hours || ' hours')::INTERVAL;
        v_execution_token TEXT := 'idemrun_' || substr(md5(random()::text || clock_timestamp()::text), 1, 24);
        v_rec RECORD;
      BEGIN
        -- Atomically attempt to reserve the slot with execution token and lease
        INSERT INTO idempotency_records (
          id, workspace_id, idempotency_key, route, method, request_hash, status,
          execution_token, lease_expires_at, expires_at, created_at, updated_at
        ) VALUES (
          p_id, p_workspace_id, p_idempotency_key, p_route, p_method, p_request_hash, 'PENDING',
          v_execution_token, v_lease_expires_at, v_expires_at, v_now, v_now
        ) ON CONFLICT (workspace_id, idempotency_key) DO NOTHING;

        -- Lock the existing or newly inserted row
        SELECT * INTO v_rec
        FROM idempotency_records
        WHERE workspace_id = p_workspace_id AND idempotency_key = p_idempotency_key
        FOR UPDATE;

        -- If this transaction successfully inserted the reservation
        IF v_rec.id = p_id THEN
          RETURN jsonb_build_object(
            'action', 'execute',
            'execution_token', v_execution_token,
            'lease_expires_at', v_lease_expires_at
          );
        END IF;

        -- Record exists from earlier request:
        -- 1. Check TTL Expiration
        IF v_rec.expires_at <= v_now THEN
          -- Expired: take over reservation with brand new execution token
          UPDATE idempotency_records
          SET id = p_id,
              route = p_route,
              method = p_method,
              request_hash = p_request_hash,
              status = 'PENDING',
              execution_token = v_execution_token,
              lease_expires_at = v_lease_expires_at,
              response_status = NULL,
              response_headers = '{}'::jsonb,
              response_body = '{}'::jsonb,
              expires_at = v_expires_at,
              updated_at = v_now
          WHERE workspace_id = p_workspace_id AND idempotency_key = p_idempotency_key;

          RETURN jsonb_build_object(
            'action', 'execute',
            'execution_token', v_execution_token,
            'lease_expires_at', v_lease_expires_at
          );
        END IF;

        -- 2. Check Route & Method binding
        IF v_rec.route <> p_route OR v_rec.method <> p_method THEN
          RETURN jsonb_build_object(
            'action', 'conflict',
            'error', 'Idempotency-Key "' || p_idempotency_key || '" was reused for a different endpoint or HTTP method'
          );
        END IF;

        -- 3. Check Payload Fingerprint
        IF v_rec.request_hash <> p_request_hash THEN
          RETURN jsonb_build_object(
            'action', 'conflict',
            'error', 'Idempotency-Key "' || p_idempotency_key || '" was previously executed with a different request payload'
          );
        END IF;

        -- 4. Check Status: PENDING
        IF v_rec.status = 'PENDING' THEN
          -- Check if lease has expired (stale worker crash / hang)
          IF v_rec.lease_expires_at IS NOT NULL AND v_rec.lease_expires_at <= v_now THEN
            -- Stale takeover: grant new execution token
            UPDATE idempotency_records
            SET id = p_id,
                execution_token = v_execution_token,
                lease_expires_at = v_lease_expires_at,
                updated_at = v_now
            WHERE workspace_id = p_workspace_id AND idempotency_key = p_idempotency_key;

            RETURN jsonb_build_object(
              'action', 'execute',
              'execution_token', v_execution_token,
              'lease_expires_at', v_lease_expires_at
            );
          END IF;

          -- Active lease still running
          RETURN jsonb_build_object(
            'action', 'in_progress',
            'error', 'A concurrent request with Idempotency-Key "' || p_idempotency_key || '" is currently in progress'
          );
        END IF;

        -- 5. Check Status: COMPLETED
        IF v_rec.status = 'COMPLETED' THEN
          RETURN jsonb_build_object(
            'action', 'cached',
            'response_status', v_rec.response_status,
            'response_headers', v_rec.response_headers,
            'response_body', v_rec.response_body
          );
        END IF;

        -- 6. Check Status: FAILED
        -- Allow retry by taking over reservation with brand new execution token
        UPDATE idempotency_records
        SET id = p_id,
            status = 'PENDING',
            execution_token = v_execution_token,
            lease_expires_at = v_lease_expires_at,
            updated_at = v_now
        WHERE workspace_id = p_workspace_id AND idempotency_key = p_idempotency_key;

        RETURN jsonb_build_object(
          'action', 'execute',
          'execution_token', v_execution_token,
          'lease_expires_at', v_lease_expires_at
        );
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
    `);
    console.log('✅ reserve_idempotency_key RPC upgraded.\n');

    // 3. Fenced Completion RPC
    console.log('3. Creating fenced complete_idempotency_key RPC...');
    await client.query(`
      CREATE OR REPLACE FUNCTION complete_idempotency_key(
        p_workspace_id TEXT,
        p_idempotency_key TEXT,
        p_execution_token TEXT,
        p_response_status INT,
        p_response_headers JSONB,
        p_response_body JSONB
      ) RETURNS JSONB AS $$
      DECLARE
        v_updated_rows INT;
      BEGIN
        UPDATE idempotency_records
        SET status = 'COMPLETED',
            response_status = p_response_status,
            response_headers = p_response_headers,
            response_body = p_response_body,
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
      $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
    `);
    console.log('✅ complete_idempotency_key RPC upgraded.\n');

    // 4. Fenced Failure RPC
    console.log('4. Creating fenced fail_idempotency_key RPC...');
    await client.query(`
      CREATE OR REPLACE FUNCTION fail_idempotency_key(
        p_workspace_id TEXT,
        p_idempotency_key TEXT,
        p_execution_token TEXT
      ) RETURNS JSONB AS $$
      DECLARE
        v_updated_rows INT;
      BEGIN
        UPDATE idempotency_records
        SET status = 'FAILED',
            updated_at = clock_timestamp()
        WHERE workspace_id = p_workspace_id
          AND idempotency_key = p_idempotency_key
          AND execution_token = p_execution_token
          AND status = 'PENDING';

        GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

        IF v_updated_rows > 0 THEN
          RETURN jsonb_build_object('success', TRUE);
        ELSE
          RETURN jsonb_build_object('success', FALSE, 'reason', 'RESERVATION_LOST');
        END IF;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
    `);
    console.log('✅ fail_idempotency_key RPC upgraded.\n');

    // 5. Fenced Lease Renewal RPC
    console.log('5. Creating renew_idempotency_lease RPC...');
    await client.query(`
      CREATE OR REPLACE FUNCTION renew_idempotency_lease(
        p_workspace_id TEXT,
        p_idempotency_key TEXT,
        p_execution_token TEXT,
        p_lease_seconds INT DEFAULT 60
      ) RETURNS JSONB AS $$
      DECLARE
        v_updated_rows INT;
      BEGIN
        UPDATE idempotency_records
        SET lease_expires_at = clock_timestamp() + (p_lease_seconds || ' seconds')::INTERVAL,
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
          RETURN jsonb_build_object('success', FALSE, 'reason', 'LEASE_LOST');
        END IF;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
    `);
    console.log('✅ renew_idempotency_lease RPC created.\n');

    // 6. Secure Rate Limiter with search_path = public
    console.log('6. Upgrading consume_rate_limit_token with search_path = public...');
    await client.query(`
      CREATE OR REPLACE FUNCTION consume_rate_limit_token(
        p_key TEXT,
        p_limit INT,
        p_window_seconds INT
      ) RETURNS JSONB AS $$
      DECLARE
        v_now TIMESTAMPTZ := clock_timestamp();
        v_window_interval INTERVAL := (p_window_seconds || ' seconds')::INTERVAL;
        v_rec RECORD;
        v_allowed BOOLEAN;
        v_remaining INT;
        v_reset_seconds INT;
      BEGIN
        SELECT * INTO v_rec FROM rate_limit_buckets WHERE key = p_key FOR UPDATE;

        IF NOT FOUND THEN
          INSERT INTO rate_limit_buckets (key, tokens_remaining, last_refill_at, expires_at)
          VALUES (p_key, p_limit, v_now, v_now + v_window_interval)
          ON CONFLICT (key) DO NOTHING;

          SELECT * INTO v_rec FROM rate_limit_buckets WHERE key = p_key FOR UPDATE;
        END IF;

        IF v_rec.expires_at <= v_now THEN
          v_rec.tokens_remaining := p_limit - 1;
          v_rec.expires_at := v_now + v_window_interval;
          v_rec.last_refill_at := v_now;
          v_allowed := TRUE;
          v_remaining := p_limit - 1;
        ELSIF v_rec.tokens_remaining > 0 THEN
          v_rec.tokens_remaining := v_rec.tokens_remaining - 1;
          v_rec.last_refill_at := v_now;
          v_allowed := TRUE;
          v_remaining := v_rec.tokens_remaining;
        ELSE
          v_allowed := FALSE;
          v_remaining := 0;
        END IF;

        UPDATE rate_limit_buckets
        SET tokens_remaining = v_rec.tokens_remaining,
            last_refill_at = v_rec.last_refill_at,
            expires_at = v_rec.expires_at
        WHERE key = p_key;

        v_reset_seconds := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_rec.expires_at - v_now)))::INT);

        RETURN jsonb_build_object(
          'allowed', v_allowed,
          'limit', p_limit,
          'remaining', v_remaining,
          'reset_seconds', v_reset_seconds,
          'retry_after_seconds', CASE WHEN v_allowed THEN NULL ELSE v_reset_seconds END
        );
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
    `);
    console.log('✅ consume_rate_limit_token upgraded.\n');

    // 7. Signature-Inspecting verify_platform_rpcs
    console.log('7. Creating signature-aware verify_platform_rpcs probe...');
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
                       AND p.pronargs >= r.min_args
                   ) THEN 'available'
                   ELSE 'signature_mismatch'
                 END as status
          FROM (VALUES
            ('claim_next_processing_job', 2),
            ('fail_processing_job', 4),
            ('publish_processed_asset', 4),
            ('consume_rate_limit_token', 3),
            ('reserve_idempotency_key', 6),
            ('complete_idempotency_key', 4),
            ('fail_idempotency_key', 3),
            ('renew_idempotency_lease', 3)
          ) AS r(rpc_name, min_args)
        ) s;
        RETURN v_res;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
    `);
    console.log('✅ verify_platform_rpcs upgraded.\n');

    // 8. Security & Privilege Hardening: Revoke public execute
    console.log('8. Hardening RPC permissions (revoke from PUBLIC/anon, grant to service_role/postgres)...');
    await client.query(`
      REVOKE ALL ON FUNCTION reserve_idempotency_key(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT) FROM PUBLIC, anon;
      GRANT EXECUTE ON FUNCTION reserve_idempotency_key(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, INT) TO service_role, postgres;

      REVOKE ALL ON FUNCTION complete_idempotency_key(TEXT, TEXT, TEXT, INT, JSONB, JSONB) FROM PUBLIC, anon;
      GRANT EXECUTE ON FUNCTION complete_idempotency_key(TEXT, TEXT, TEXT, INT, JSONB, JSONB) TO service_role, postgres;

      REVOKE ALL ON FUNCTION fail_idempotency_key(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
      GRANT EXECUTE ON FUNCTION fail_idempotency_key(TEXT, TEXT, TEXT) TO service_role, postgres;

      REVOKE ALL ON FUNCTION renew_idempotency_lease(TEXT, TEXT, TEXT, INT) FROM PUBLIC, anon;
      GRANT EXECUTE ON FUNCTION renew_idempotency_lease(TEXT, TEXT, TEXT, INT) TO service_role, postgres;

      REVOKE ALL ON FUNCTION consume_rate_limit_token(TEXT, INT, INT) FROM PUBLIC, anon;
      GRANT EXECUTE ON FUNCTION consume_rate_limit_token(TEXT, INT, INT) TO service_role, postgres;

      REVOKE ALL ON FUNCTION verify_platform_rpcs() FROM PUBLIC, anon;
      GRANT EXECUTE ON FUNCTION verify_platform_rpcs() TO service_role, postgres;
    `);
    console.log('✅ RPC permissions hardened.\n');

    console.log('🎉 All v3.8.2 Reliability Semantics Gate migrations applied successfully!');
  } finally {
    await client.end();
  }
}

runMigration().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
