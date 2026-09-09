const { Client } = require('pg');
const fs = require('fs');

const env = fs.readFileSync('.env.local', 'utf8');
for (const line of env.split('\n')) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    let val = match[2].trim();
    if ((val.startsWith('') && val.endsWith('')) || (val.startsWith(') && val.endsWith('))) {
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
    console.log('Updating renew_job_heartbeat RPC function with strict fencing...');
    await client.query([
      'DROP FUNCTION IF EXISTS renew_job_heartbeat(TEXT, TEXT, INT);',
      'DROP FUNCTION IF EXISTS renew_job_heartbeat(TEXT, TEXT, INT, TEXT);',
      'CREATE OR REPLACE FUNCTION renew_job_heartbeat(',
      '  p_job_id TEXT,',
      '  p_worker_id TEXT,',
      '  p_lease_seconds INT DEFAULT 300,',
      '  p_job_run_id TEXT DEFAULT NULL',
      ')',
      'RETURNS BOOLEAN',
      'LANGUAGE plpgsql',
      'AS $$',
      'DECLARE',
      '  v_updated INT;',
      'BEGIN',
      '  UPDATE processing_jobs',
      '  SET',
      '    heartbeat_at = NOW(),',
      "    lease_expires_at = NOW() + (p_lease_seconds || ' seconds')::interval,",
      '    updated_at = NOW()',
      '  WHERE id = p_job_id',
      "    AND status = 'processing'",
      '    AND locked_by = p_worker_id',
      '    AND lease_expires_at > NOW()',
      '    AND (p_job_run_id IS NULL OR job_run_id = p_job_run_id);',
      '',
      '  GET DIAGNOSTICS v_updated = ROW_COUNT;',
      '  RETURN v_updated > 0;',
      'END;',
      '$$;'
    ].join('\n'));

    console.log('Reloading PostgREST schema cache...');
    await client.query("NOTIFY pgrst, 'reload schema';");

    console.log('✅ v3.4 Migration completed successfully: renew_job_heartbeat hardened with lease & run_id fencing!');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
