const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { databaseClient } = require('./lib/database.cjs');

async function migrate() {
  const client = databaseClient();
  const dryRun = process.argv.includes('--dry-run');
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('media-platform-migrations'))");
    await client.query('CREATE TABLE IF NOT EXISTS public.platform_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    await client.query('ALTER TABLE public.platform_migrations ENABLE ROW LEVEL SECURITY');
    await client.query('REVOKE ALL ON public.platform_migrations FROM anon, authenticated');
    for (const name of fs.readdirSync('supabase/migrations').filter(n=>n.endsWith('.sql')).sort()) {
      const sql = fs.readFileSync(path.join('supabase/migrations', name), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      const applied = (await client.query('SELECT checksum FROM public.platform_migrations WHERE name=$1',[name])).rows[0];
      if (applied) {
        if (applied.checksum !== checksum) throw new Error(`Applied migration checksum changed: ${name}`);
        console.log(`Already applied: ${name}`);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO public.platform_migrations(name,checksum) VALUES($1,$2)',[name,checksum]);
      console.log(`Validated: ${name}`);
    }
    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
    console.log(dryRun ? 'Dry run rolled back.' : 'Migrations committed.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { await client.end(); }
}
if (require.main === module) migrate().catch(e=>{console.error('Migration failed:',e.code || e.message);process.exitCode=1;});
module.exports = { migrate };
