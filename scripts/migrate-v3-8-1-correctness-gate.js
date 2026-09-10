/**
 * Database Migration: v3.8.1 Correctness Gate
 * 1. Atomic PostgreSQL Rate Limiter RPC (consume_rate_limit_token)
 * 2. Atomic Idempotency State Machine RPCs (reserve_idempotency_key, complete_idempotency_key)
 * 3. Non-mutating System RPC Health Verification (verify_platform_rpcs)
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

  console.log('Connecting to Supabase PostgreSQL for v3.8.1 migration...');
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log('Connected successfully!\n');

  try {
    // 1. Update idempotency_records schema
    console.log('1. Enhancing idempotency_records schema with status and method columns...');
    await client.query(`
      ALTER TABLE idempotency_records ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'COMPLETED';
      ALTER TABLE idempotency_records ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'POST';
      ALTER TABLE idempotency_records ALTER COLUMN response_status DROP NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_idempotency_lookup ON idempotency_records(workspace_id, route, idempotency_key);
    `);
    console.log('✅ idempotency_records schema updated.\n');

    // 2. Atomic Rate Limiter RPC
    console.log('2. Creating atomic PostgreSQL rate limiter RPC (consume_rate_limit_token)...');
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
        -- Lock existing bucket row
        SELECT * INTO v_rec FROM rate_limit_buckets WHERE key = p_key FOR UPDATE;

        IF NOT FOUND THEN
          -- Initialize new bucket atomically with full quota
          INSERT INTO rate_limit_buckets (key, tokens_remaining, last_refill_at, expires_at)
          VALUES (p_key, p_limit, v_now, v_now + v_window_interval)
          ON CONFLICT (key) DO NOTHING;

          -- Lock row whether inserted by this worker or concurrent transaction
          SELECT * INTO v_rec FROM rate_limit_buckets WHERE key = p_key FOR UPDATE;
        END IF;

        -- Window evaluation
        IF v_rec.expires_at <= v_now THEN
          -- Window expired: full refill minus 1 token
          v_rec.tokens_remaining := p_limit - 1;
          v_rec.expires_at := v_now + v_window_interval;
          v_rec.last_refill_at := v_now;
          v_allowed := TRUE;
          v_remaining := p_limit - 1;
        ELSIF v_rec.tokens_remaining > 0 THEN
          -- Token available: decrement atomically
          v_rec.tokens_remaining := v_rec.tokens_remaining - 1;
          v_rec.last_refill_at := v_now;
          v_allowed := TRUE;
          v_remaining := v_rec.tokens_remaining;
        ELSE
          -- Bucket exhausted
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
      $$ LANGUAGE plpgsql SECURITY DEFINER;
    `);
    console.log('✅ consume_rate_limit_token RPC created.\n');

    // 3. Atomic Idempotency RPCs
    console.log('3. Creating atomic idempotency state machine RPCs...');
    await client.query(`
      CREATE OR REPLACE FUNCTION reserve_idempotency_key(
        p_id TEXT,
        p_workspace_id TEXT,
        p_idempotency_key TEXT,
        p_route TEXT,
        p_method TEXT,
        p_request_hash TEXT,
        p_ttl_hours INT DEFAULT 24
      ) RETURNS JSONB AS $$
      DECLARE
        v_now TIMESTAMPTZ := clock_timestamp();
        v_expires_at TIMESTAMPTZ := v_now + (p_ttl_hours || ' hours')::INTERVAL;
        v_rec RECORD;
      BEGIN
        -- Atomically attempt to reserve the slot using ON CONFLICT DO NOTHING
        INSERT INTO idempotency_records (
          id, workspace_id, idempotency_key, route, method, request_hash, status, expires_at, created_at
        ) VALUES (
          p_id, p_workspace_id, p_idempotency_key, p_route, p_method, p_request_hash, 'PENDING', v_expires_at, v_now
        ) ON CONFLICT (workspace_id, idempotency_key) DO NOTHING;

        -- Lock the existing or newly inserted row
        SELECT * INTO v_rec
        FROM idempotency_records
        WHERE workspace_id = p_workspace_id AND idempotency_key = p_idempotency_key
        FOR UPDATE;

        -- If this transaction successfully inserted the reservation
        IF v_rec.id = p_id THEN
          RETURN jsonb_build_object('action', 'execute');
        END IF;

        -- Record exists: verify expiration
        IF v_rec.expires_at <= v_now THEN
          -- Expired: take over reservation
          UPDATE idempotency_records
          SET route = p_route,
              method = p_method,
              request_hash = p_request_hash,
              status = 'PENDING',
              response_status = NULL,
              response_headers = '{}'::jsonb,
              response_body = '{}'::jsonb,
              expires_at = v_expires_at,
              created_at = v_now
          WHERE id = v_rec.id;

          RETURN jsonb_build_object('action', 'execute');
        END IF;

        -- Check Route and Method binding
        IF v_rec.route <> p_route OR v_rec.method <> p_method THEN
          RETURN jsonb_build_object(
            'action', 'conflict',
            'error', 'Idempotency-Key "' || p_idempotency_key || '" was reused for a different endpoint or HTTP method'
          );
        END IF;

        -- Check Payload Fingerprint
        IF v_rec.request_hash <> p_request_hash THEN
          RETURN jsonb_build_object(
            'action', 'conflict',
            'error', 'Idempotency-Key "' || p_idempotency_key || '" was previously executed with a different request payload'
          );
        END IF;

        -- Status: PENDING
        IF v_rec.status = 'PENDING' THEN
          -- If pending for more than 45 seconds, assume stale worker crash and allow takeover
          IF v_rec.created_at < v_now - INTERVAL '45 seconds' THEN
            UPDATE idempotency_records
            SET status = 'PENDING', created_at = v_now
            WHERE id = v_rec.id;
            RETURN jsonb_build_object('action', 'execute');
          END IF;

          RETURN jsonb_build_object(
            'action', 'in_progress',
            'error', 'A concurrent request with Idempotency-Key "' || p_idempotency_key || '" is currently in progress'
          );
        END IF;

        -- Status: COMPLETED
        IF v_rec.status = 'COMPLETED' THEN
          RETURN jsonb_build_object(
            'action', 'cached',
            'response_status', v_rec.response_status,
            'response_headers', v_rec.response_headers,
            'response_body', v_rec.response_body
          );
        END IF;

        -- Status: FAILED
        -- Allow retry by taking over reservation
        UPDATE idempotency_records
        SET status = 'PENDING', created_at = v_now
        WHERE id = v_rec.id;

        RETURN jsonb_build_object('action', 'execute');
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;

      CREATE OR REPLACE FUNCTION complete_idempotency_key(
        p_workspace_id TEXT,
        p_idempotency_key TEXT,
        p_response_status INT,
        p_response_headers JSONB,
        p_response_body JSONB
      ) RETURNS VOID AS $$
      BEGIN
        UPDATE idempotency_records
        SET status = 'COMPLETED',
            response_status = p_response_status,
            response_headers = p_response_headers,
            response_body = p_response_body
        WHERE workspace_id = p_workspace_id AND idempotency_key = p_idempotency_key;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;

      CREATE OR REPLACE FUNCTION fail_idempotency_key(
        p_workspace_id TEXT,
        p_idempotency_key TEXT
      ) RETURNS VOID AS $$
      BEGIN
        UPDATE idempotency_records
        SET status = 'FAILED'
        WHERE workspace_id = p_workspace_id AND idempotency_key = p_idempotency_key;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;
    `);
    console.log('✅ reserve_idempotency_key and complete_idempotency_key RPCs created.\n');

    // 4. Non-mutating RPC Verification Probe
    console.log('4. Creating non-mutating verify_platform_rpcs probe...');
    await client.query(`
      CREATE OR REPLACE FUNCTION verify_platform_rpcs()
      RETURNS JSONB AS $$
      DECLARE
        v_res JSONB;
      BEGIN
        SELECT jsonb_object_agg(name, status) INTO v_res
        FROM (
          SELECT rpc_name as name,
                 CASE WHEN EXISTS (
                   SELECT 1 FROM pg_proc p
                   JOIN pg_namespace n ON p.pronamespace = n.oid
                   WHERE n.nspname = 'public' AND p.proname = rpc_name
                 ) THEN 'available' ELSE 'missing' END as status
          FROM unnest(ARRAY[
            'claim_next_processing_job',
            'fail_processing_job',
            'publish_processed_asset',
            'consume_rate_limit_token',
            'reserve_idempotency_key'
          ]) as rpc_name
        ) s;
        RETURN v_res;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;
    `);
    console.log('✅ verify_platform_rpcs probe created.\n');

    console.log('🎉 All v3.8.1 Correctness Gate migrations applied successfully!');
  } finally {
    await client.end();
  }
}

runMigration().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
