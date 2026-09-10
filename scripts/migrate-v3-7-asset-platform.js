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
  console.log('Connecting to Supabase Postgres...');
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log('Connected successfully!');

  try {
    console.log('1. Adding output_version to asset_variants...');
    await client.query(`
      ALTER TABLE asset_variants ADD COLUMN IF NOT EXISTS output_version TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_variants_unique ON asset_variants(asset_id, variant_name, COALESCE(output_version, ''));
    `);
    console.log('✅ asset_variants table hardened.');

    console.log('2. Adding quarantined to asset_status_enum...');
    try {
      await client.query(`ALTER TYPE asset_status_enum ADD VALUE IF NOT EXISTS 'quarantined';`);
      console.log('✅ asset_status_enum updated with quarantined.');
    } catch (err) {
      console.log('ℹ️ asset_status_enum note:', err.message);
    }

    console.log('3. Creating integrity_issues table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS integrity_issues (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        asset_id TEXT,
        issue_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        storage_key TEXT,
        details JSONB DEFAULT '{}'::jsonb,
        status TEXT NOT NULL DEFAULT 'detected',
        detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_integrity_issues_workspace ON integrity_issues(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_integrity_issues_asset ON integrity_issues(asset_id);
      CREATE INDEX IF NOT EXISTS idx_integrity_issues_status ON integrity_issues(status);
      CREATE INDEX IF NOT EXISTS idx_integrity_issues_type ON integrity_issues(issue_type);
    `);
    console.log('✅ integrity_issues table created.');

    console.log('4. Creating sync_asset_references transactional RPC...');
    await client.query(`
      CREATE OR REPLACE FUNCTION sync_asset_references(
        p_workspace_id TEXT,
        p_source_app TEXT,
        p_entity_type TEXT,
        p_entity_id TEXT,
        p_references JSONB,
        p_application_id TEXT DEFAULT NULL
      )
      RETURNS JSONB
      LANGUAGE plpgsql
      AS $$
      DECLARE
        v_ref JSONB;
        v_asset_id TEXT;
        v_asset_exists BOOLEAN;
        v_count INT := 0;
        v_now TIMESTAMPTZ := NOW();
      BEGIN
        -- 1. Validate all referenced assets exist in this exact workspace
        IF p_references IS NOT NULL AND jsonb_array_length(p_references) > 0 THEN
          FOR v_ref IN SELECT * FROM jsonb_array_elements(p_references) LOOP
            v_asset_id := v_ref->>'asset_id';
            SELECT EXISTS(
              SELECT 1 FROM assets WHERE id = v_asset_id AND workspace_id = p_workspace_id
            ) INTO v_asset_exists;

            IF NOT v_asset_exists THEN
              RAISE EXCEPTION 'CROSS_WORKSPACE_FORBIDDEN: Asset % does not exist or does not belong to workspace %', v_asset_id, p_workspace_id;
            END IF;
          END LOOP;
        END IF;

        -- 2. Delete stale references for this entity in this workspace
        DELETE FROM asset_references
        WHERE workspace_id = p_workspace_id
          AND source_app = p_source_app
          AND entity_type = p_entity_type
          AND entity_id = p_entity_id;

        -- 3. Insert new references
        IF p_references IS NOT NULL AND jsonb_array_length(p_references) > 0 THEN
          FOR v_ref IN SELECT * FROM jsonb_array_elements(p_references) LOOP
            INSERT INTO asset_references (
              id,
              workspace_id,
              asset_id,
              application_id,
              source_app,
              entity_type,
              entity_id,
              field_name,
              context,
              created_at,
              updated_at
            ) VALUES (
              COALESCE(v_ref->>'id', 'ref_' || substr(md5(random()::text || clock_timestamp()::text), 1, 20)),
              p_workspace_id,
              v_ref->>'asset_id',
              v_ref->>'application_id',
              p_source_app,
              p_entity_type,
              p_entity_id,
              v_ref->>'field_name',
              COALESCE((v_ref->'context'), '{}'::jsonb),
              v_now,
              v_now
            );
            v_count := v_count + 1;
          END LOOP;
        END IF;

        RETURN jsonb_build_object('success', true, 'count', v_count);
      END;
      $$;
    `);
    console.log('✅ sync_asset_references RPC created.');

    console.log('5. Creating universal atomic CAS publish_processed_asset RPC...');
    await client.query(`
      CREATE OR REPLACE FUNCTION publish_processed_asset(
        p_job_id TEXT,
        p_worker_id TEXT,
        p_job_run_id TEXT,
        p_output_version TEXT,
        p_output_manifest JSONB,
        p_asset_metadata JSONB DEFAULT '{}'::jsonb,
        p_variants JSONB DEFAULT '[]'::jsonb
      )
      RETURNS JSONB
      LANGUAGE plpgsql
      AS $$
      DECLARE
        v_job RECORD;
        v_now TIMESTAMPTZ := NOW();
        v_variant JSONB;
      BEGIN
        -- Fencing check: must match worker, run_id, active lease, and processing status
        SELECT * INTO v_job
        FROM processing_jobs
        WHERE id = p_job_id
          AND status = 'processing'
          AND locked_by = p_worker_id
          AND (p_job_run_id IS NULL OR job_run_id = p_job_run_id)
          AND lease_expires_at > v_now
        FOR UPDATE;

        IF NOT FOUND THEN
          RETURN jsonb_build_object('success', false, 'reason', 'LEASE_LOST');
        END IF;

        -- Update processing_jobs
        UPDATE processing_jobs
        SET
          status = 'completed',
          current_stage = 'ready',
          progress = 100,
          output_version = p_output_version,
          metadata_json = COALESCE(metadata_json, '{}'::jsonb) || jsonb_build_object('output_manifest', p_output_manifest),
          completed_at = v_now,
          locked_by = NULL,
          locked_at = NULL,
          lease_expires_at = NULL,
          updated_at = v_now
        WHERE id = p_job_id;

        -- Update assets
        UPDATE assets
        SET
          processing_status = 'ready',
          status = 'active',
          metadata_json = COALESCE(metadata_json, '{}'::jsonb) || p_asset_metadata || jsonb_build_object('active_output_version', p_output_version),
          updated_at = v_now
        WHERE id = v_job.asset_id;

        -- Upsert variants if provided
        IF p_variants IS NOT NULL AND jsonb_array_length(p_variants) > 0 THEN
          FOR v_variant IN SELECT * FROM jsonb_array_elements(p_variants) LOOP
            INSERT INTO asset_variants (
              id,
              asset_id,
              variant_name,
              output_version,
              storage_provider,
              storage_key,
              storage_url,
              mime_type,
              format,
              width,
              height,
              size_bytes,
              quality,
              status,
              created_at,
              updated_at
            ) VALUES (
              COALESCE(v_variant->>'id', 'var_' || substr(md5(random()::text || clock_timestamp()::text), 1, 20)),
              v_job.asset_id,
              v_variant->>'variant_name',
              p_output_version,
              COALESCE(v_variant->>'storage_provider', 'supabase'),
              v_variant->>'storage_key',
              v_variant->>'storage_url',
              COALESCE(v_variant->>'mime_type', 'image/webp'),
              v_variant->>'format',
              (v_variant->>'width')::int,
              (v_variant->>'height')::int,
              COALESCE((v_variant->>'size_bytes')::bigint, 0),
              COALESCE((v_variant->>'quality')::int, 80),
              'ready',
              v_now,
              v_now
            )
            ON CONFLICT (asset_id, variant_name, COALESCE(output_version, ''))
            DO UPDATE SET
              storage_key = EXCLUDED.storage_key,
              size_bytes = EXCLUDED.size_bytes,
              width = EXCLUDED.width,
              height = EXCLUDED.height,
              updated_at = v_now;
          END LOOP;
        END IF;

        RETURN jsonb_build_object('success', true, 'status', 'ready', 'output_version', p_output_version);
      END;
      $$;
    `);
    console.log('✅ publish_processed_asset RPC created.');

  } finally {
    await client.end();
  }
}
runMigration().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
