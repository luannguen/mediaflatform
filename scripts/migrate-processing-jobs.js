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
  console.log('Connecting to Postgres...');

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to Postgres successfully!');

  try {
    console.log('Running ALTER TABLE processing_jobs...');
    await client.query(`
      ALTER TABLE processing_jobs
        ADD COLUMN IF NOT EXISTS current_stage TEXT NOT NULL DEFAULT 'queued',
        ADD COLUMN IF NOT EXISTS progress INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS source_storage_key TEXT,
        ADD COLUMN IF NOT EXISTS source_storage_url TEXT,
        ADD COLUMN IF NOT EXISTS target_profiles JSONB DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 5,
        ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3,
        ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS metadata_json JSONB DEFAULT '{}'::jsonb;
    `);

    console.log('Updating check constraints on processing_jobs...');
    await client.query(`
      ALTER TABLE processing_jobs DROP CONSTRAINT IF EXISTS processing_jobs_status_check;
      ALTER TABLE processing_jobs ADD CONSTRAINT processing_jobs_status_check 
        CHECK (status = ANY (ARRAY['queued'::text, 'pending'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'cancelled'::text]));
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_jobs_workspace_status ON processing_jobs(workspace_id, status);
      CREATE INDEX IF NOT EXISTS idx_jobs_asset ON processing_jobs(asset_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_queue ON processing_jobs(status, priority DESC, created_at ASC);
    `);

    console.log('Reloading PostgREST schema cache...');
    await client.query(`NOTIFY pgrst, 'reload schema';`);

    console.log('Migration completed successfully!');
  } catch (err) {
    console.error('Migration error:', err);
  } finally {
    await client.end();
  }
}

runMigration();
