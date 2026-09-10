const { Client } = require('pg');
const fs = require('fs');

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
  console.log('Connecting to Supabase Postgres for v3.8 migration...');
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log('Connected successfully!');

  try {
    console.log('1. Creating worker_instances table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS worker_instances (
        id TEXT PRIMARY KEY,
        worker_id TEXT NOT NULL,
        instance_id TEXT NOT NULL,
        version TEXT NOT NULL DEFAULT 'v3.8.0',
        hostname TEXT,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        status TEXT NOT NULL DEFAULT 'online',
        current_job_id TEXT,
        capabilities JSONB DEFAULT '{}'::jsonb,
        runtime_info JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_worker_instances_worker_id ON worker_instances(worker_id);
      CREATE INDEX IF NOT EXISTS idx_worker_instances_heartbeat ON worker_instances(last_heartbeat_at);
      CREATE INDEX IF NOT EXISTS idx_worker_instances_status ON worker_instances(status);
    `);
    console.log('✅ worker_instances table created.');

    console.log('2. Creating idempotency_records table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS idempotency_records (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        route TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        response_status INT NOT NULL,
        response_headers JSONB DEFAULT '{}'::jsonb,
        response_body JSONB DEFAULT '{}'::jsonb,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency_ws_key ON idempotency_records(workspace_id, idempotency_key);
      CREATE INDEX IF NOT EXISTS idx_idempotency_expires_at ON idempotency_records(expires_at);
    `);
    console.log('✅ idempotency_records table created.');

    console.log('3. Creating rate_limit_buckets table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS rate_limit_buckets (
        key TEXT PRIMARY KEY,
        tokens_remaining INT NOT NULL,
        last_refill_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rate_limit_expires ON rate_limit_buckets(expires_at);
    `);
    console.log('✅ rate_limit_buckets table created.');

    console.log('4. Creating operational_alerts table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS operational_alerts (
        id TEXT PRIMARY KEY,
        alert_key TEXT UNIQUE NOT NULL,
        alert_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'firing',
        message TEXT NOT NULL,
        details JSONB DEFAULT '{}'::jsonb,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_operational_alerts_status ON operational_alerts(status);
      CREATE INDEX IF NOT EXISTS idx_operational_alerts_type ON operational_alerts(alert_type);
    `);
    console.log('✅ operational_alerts table created.');

    console.log('5. Hardening api_keys and api_request_logs...');
    await client.query(`
      ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS replaces_key_id TEXT;
      ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ;
      ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS environment TEXT DEFAULT 'production';

      ALTER TABLE api_request_logs ADD COLUMN IF NOT EXISTS api_key_id TEXT;
      ALTER TABLE api_request_logs ADD COLUMN IF NOT EXISTS response_bytes INT;

      CREATE INDEX IF NOT EXISTS idx_api_request_logs_workspace_time ON api_request_logs(workspace_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_api_request_logs_request_id ON api_request_logs(request_id);
    `);
    console.log('✅ api_keys and api_request_logs hardened.');

    console.log('\n🚀 ALL v3.8 DATABASE MIGRATIONS COMPLETED SUCCESSFULLY!');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration().catch((err) => {
  console.error('Fatal error during migration:', err);
  process.exit(1);
});
