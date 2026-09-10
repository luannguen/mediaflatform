const fs = require('fs');
const { Client } = require('pg');

if (fs.existsSync('.env.local')) {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      let val = match[2].trim().replace(/^["']|["']$/g, '');
      process.env[match[1].trim()] = val;
    }
  }
}

async function main() {
  const client = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const res = await client.query(`
    SELECT pid, query, state, wait_event_type, wait_event, age(clock_timestamp(), query_start) as duration
    FROM pg_stat_activity
    WHERE state != 'idle' AND pid != pg_backend_pid();
  `);
  console.log('Active queries in Postgres:', res.rows);
  await client.end();
}
main().catch(console.error);
