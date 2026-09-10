const fs = require('fs');
const { Client } = require('pg');

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

async function main() {
  const client = new Client({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const res = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'workspace_memberships'
    ORDER BY ordinal_position;
  `);
  console.log('workspace_memberships columns:', res.rows);

  const resUsers = await client.query(`
    SELECT id, email, raw_user_meta_data
    FROM auth.users;
  `);
  console.log('auth.users:', resUsers.rows);

  const resRoles = await client.query(`
    SELECT * FROM roles;
  `);
  console.log('roles table:', resRoles.rows);

  await client.end();
}

main().catch(console.error);
