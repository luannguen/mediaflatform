const { Client } = require('pg');
const fs = require('fs');

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

async function runMigration() {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  console.log('Connecting to Postgres (Supabase)...');

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to Postgres successfully!');

  try {
    console.log('Creating atomic fail_processing_job RPC function with CAS fencing...');
    const queryText = `
CREATE OR REPLACE FUNCTION fail_processing_job(
  p_job_id TEXT,
  p_worker_id TEXT,
  p_job_run_id TEXT,
  p_error_code TEXT,
  p_error_message TEXT,
  p_is_retryable BOOLEAN,
  p_backoff_seconds INT DEFAULT 30,
  p_error_details JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_job RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_can_retry BOOLEAN;
  v_available_at TIMESTAMPTZ;
  v_current_attempt INT;
  v_max_attempts INT;
BEGIN
  -- 1. Fenced check: must be locked by worker, active lease, and matching run_id
  SELECT * INTO v_job
  FROM processing_jobs
  WHERE id = p_job_id
    AND status = 'processing'
    AND locked_by = p_worker_id
    AND lease_expires_at > v_now
    AND (p_job_run_id IS NULL OR job_run_id = p_job_run_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Zombie worker or lease lost
    RETURN jsonb_build_object('success', false, 'reason', 'LEASE_LOST');
  END IF;

  v_current_attempt := COALESCE(v_job.attempt, 1);
  v_max_attempts := COALESCE(v_job.max_attempts, 3);
  v_can_retry := p_is_retryable AND (v_current_attempt < v_max_attempts);

  IF v_can_retry THEN
    v_available_at := v_now + (p_backoff_seconds || ' seconds')::interval;

    UPDATE processing_jobs
    SET
      status = 'retrying',
      current_stage = 'queued',
      attempt = v_current_attempt + 1,
      available_at = v_available_at,
      locked_by = NULL,
      locked_at = NULL,
      lease_expires_at = NULL,
      error_code = p_error_code,
      error_taxonomy = p_error_code,
      error_message = p_error_message,
      error_details = p_error_details,
      updated_at = v_now
    WHERE id = p_job_id;

    RETURN jsonb_build_object(
      'success', true,
      'status', 'retrying',
      'attempt', v_current_attempt + 1,
      'available_at', v_available_at
    );
  ELSE
    -- Dead Letter Queue & Atomic Asset Failure in same transaction
    UPDATE processing_jobs
    SET
      status = 'dead_letter',
      error_code = p_error_code,
      error_taxonomy = p_error_code,
      error_message = p_error_message,
      error_details = p_error_details,
      completed_at = v_now,
      locked_by = NULL,
      locked_at = NULL,
      lease_expires_at = NULL,
      updated_at = v_now
    WHERE id = p_job_id;

    UPDATE assets
    SET
      processing_status = 'failed',
      updated_at = v_now
    WHERE id = v_job.asset_id;

    RETURN jsonb_build_object(
      'success', true,
      'status', 'dead_letter',
      'attempt', v_current_attempt
    );
  END IF;
END;
$$;
`;

    await client.query(queryText);
    console.log('✅ PostgreSQL RPC fail_processing_job created successfully!');
  } finally {
    await client.end();
  }
}

runMigration().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
