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
    console.log('Step 1: Adding resilient queue columns to processing_jobs...');
    await client.query(`
      ALTER TABLE processing_jobs
        ADD COLUMN IF NOT EXISTS locked_by TEXT,
        ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS job_run_id TEXT,
        ADD COLUMN IF NOT EXISTS output_version TEXT,
        ADD COLUMN IF NOT EXISTS error_taxonomy TEXT,
        ADD COLUMN IF NOT EXISTS error_details JSONB DEFAULT '{}'::jsonb;
    `);

    console.log('Step 2: Updating processing_jobs_status_check constraint...');
    await client.query(`
      ALTER TABLE processing_jobs DROP CONSTRAINT IF EXISTS processing_jobs_status_check;
      ALTER TABLE processing_jobs ADD CONSTRAINT processing_jobs_status_check 
        CHECK (status = ANY (ARRAY[
          'queued'::text, 
          'pending'::text, 
          'processing'::text, 
          'retrying'::text, 
          'completed'::text, 
          'failed'::text, 
          'dead_letter'::text, 
          'cancelled'::text
        ]));
    `);

    console.log('Step 3: Creating performance indexes for atomic claiming and lease management...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_jobs_claim_atomic 
        ON processing_jobs(status, available_at, priority DESC, created_at ASC);
      
      CREATE INDEX IF NOT EXISTS idx_jobs_lease_expiry 
        ON processing_jobs(status, lease_expires_at);

      CREATE INDEX IF NOT EXISTS idx_jobs_dead_letter 
        ON processing_jobs(workspace_id, status);
    `);

    console.log('Step 4: Creating atomic queue RPC functions (claim_next_processing_job & renew_job_heartbeat)...');
    await client.query(`
      CREATE OR REPLACE FUNCTION claim_next_processing_job(
        p_worker_id TEXT,
        p_lease_seconds INT DEFAULT 300,
        p_job_run_id TEXT DEFAULT NULL
      )
      RETURNS SETOF processing_jobs
      LANGUAGE plpgsql
      AS $$
      DECLARE
        v_job_id TEXT;
        v_run_id TEXT;
      BEGIN
        v_run_id := COALESCE(p_job_run_id, 'run_' || substr(md5(random()::text), 1, 12));

        -- Select candidate job using FOR UPDATE SKIP LOCKED
        SELECT id INTO v_job_id
        FROM processing_jobs
        WHERE (
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
      $$;

      CREATE OR REPLACE FUNCTION renew_job_heartbeat(
        p_job_id TEXT,
        p_worker_id TEXT,
        p_lease_seconds INT DEFAULT 300
      )
      RETURNS BOOLEAN
      LANGUAGE plpgsql
      AS $$
      DECLARE
        v_updated INT;
      BEGIN
        UPDATE processing_jobs
        SET
          heartbeat_at = NOW(),
          lease_expires_at = NOW() + (p_lease_seconds || ' seconds')::interval,
          updated_at = NOW()
        WHERE id = p_job_id
          AND status = 'processing'
          AND (locked_by IS NULL OR locked_by = p_worker_id);

        GET DIAGNOSTICS v_updated = ROW_COUNT;
        RETURN v_updated > 0;
      END;
      $$;
    `);

    console.log('Step 5: Reloading PostgREST schema cache...');
    await client.query(`NOTIFY pgrst, 'reload schema';`);

    console.log('✅ v3.2 Migration completed successfully!');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
