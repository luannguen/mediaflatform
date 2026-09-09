const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Load .env.local
const envPath = path.resolve(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
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

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;

async function migrate() {
  console.log('🚀 RUNNING DATABASE MIGRATION V2.0 (ENTERPRISE DAM)...');
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('  ✅ Connected to PostgreSQL');

  try {
    // 1. Create table asset_versions
    console.log('  Creating table asset_versions...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.asset_versions (
        id VARCHAR(64) PRIMARY KEY,
        asset_id VARCHAR(64) NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL,
        storage_key TEXT NOT NULL,
        storage_url TEXT,
        size_bytes BIGINT NOT NULL DEFAULT 0,
        mime_type VARCHAR(100) NOT NULL,
        checksum VARCHAR(128),
        width INTEGER,
        height INTEGER,
        created_by VARCHAR(64),
        comment TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_asset_version UNIQUE (asset_id, version_number)
      );

      CREATE INDEX IF NOT EXISTS idx_asset_versions_asset_id 
        ON public.asset_versions(asset_id, version_number DESC);
    `);
    console.log('  ✅ Table asset_versions created');

    // 2. Create table usage_metrics
    console.log('  Creating table usage_metrics...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.usage_metrics (
        id VARCHAR(64) PRIMARY KEY,
        workspace_id VARCHAR(64) NOT NULL,
        asset_id VARCHAR(64),
        event_type VARCHAR(32) NOT NULL, -- 'delivery', 'cache_hit', 'upload', 'replace', 'delete'
        bytes_transferred BIGINT NOT NULL DEFAULT 0,
        bytes_saved BIGINT NOT NULL DEFAULT 0,
        format VARCHAR(32),
        latency_ms INTEGER NOT NULL DEFAULT 0,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_usage_metrics_ws_time 
        ON public.usage_metrics(workspace_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_usage_metrics_asset_event 
        ON public.usage_metrics(asset_id, event_type);
    `);
    console.log('  ✅ Table usage_metrics created');

    console.log('\n🎉 DATABASE MIGRATION V2.0 COMPLETED SUCCESSFULLY!');
  } finally {
    await client.end();
  }
}

migrate().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
