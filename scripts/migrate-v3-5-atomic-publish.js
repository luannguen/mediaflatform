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
    console.log('Creating atomic publish_transcoded_asset RPC function...');
    await client.query([
      'CREATE OR REPLACE FUNCTION publish_transcoded_asset(',
      '  p_job_id TEXT,',
      '  p_worker_id TEXT,',
      '  p_job_run_id TEXT,',
      '  p_output_version TEXT,',
      '  p_output_manifest JSONB',
      ')',
      'RETURNS BOOLEAN',
      'LANGUAGE plpgsql',
      'AS $$',
      'DECLARE',
      '  v_asset_id TEXT;',
      '  v_updated INT;',
      'BEGIN',
      '  -- 1. Fenced update on processing_jobs',
      '  UPDATE processing_jobs',
      '  SET',
      "    status = 'completed',",
      "    current_stage = 'ready',",
      '    progress = 100,',
      '    output_version = p_output_version,',
      '    completed_at = NOW(),',
      '    heartbeat_at = NOW(),',
      '    lease_expires_at = NULL,',
      '    updated_at = NOW(),',
      "    metadata_json = jsonb_set(COALESCE(metadata_json, '{}'::jsonb), '{output_manifest}', p_output_manifest)",
      '  WHERE id = p_job_id',
      "    AND status = 'processing'",
      '    AND locked_by = p_worker_id',
      '    AND lease_expires_at > NOW()',
      '    AND (p_job_run_id IS NULL OR job_run_id = p_job_run_id)',
      '  RETURNING asset_id INTO v_asset_id;',
      '',
      '  GET DIAGNOSTICS v_updated = ROW_COUNT;',
      '  IF v_updated = 0 OR v_asset_id IS NULL THEN',
      '    RETURN FALSE;',
      '  END IF;',
      '',
      '  -- 2. Atomic publish to assets',
      '  UPDATE assets',
      '  SET',
      "    processing_status = 'ready',",
      '    metadata_json = jsonb_set(',
      "      jsonb_set(COALESCE(metadata_json, '{}'::jsonb), '{active_output_version}', to_jsonb(p_output_version)),",
      "      '{hls}',",
      '      p_output_manifest',
      '    ),',
      '    updated_at = NOW()',
      '  WHERE id = v_asset_id;',
      '',
      '  RETURN TRUE;',
      'END;',
      '$$;'
    ].join('\n'));

    console.log('Reloading PostgREST schema cache...');
    await client.query("NOTIFY pgrst, 'reload schema';");

    console.log('✅ v3.5 Migration completed successfully: publish_transcoded_asset RPC created!');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
