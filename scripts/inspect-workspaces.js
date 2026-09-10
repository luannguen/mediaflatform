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

  const ws = await client.query('SELECT * FROM workspaces');
  console.log('Workspaces in DB:', ws.rows);

  const orgs = await client.query('SELECT * FROM organizations');
  console.log('Organizations in DB:', orgs.rows);

  const mems = await client.query('SELECT * FROM workspace_memberships');
  console.log('Workspace Memberships in DB:', mems.rows);

  await client.end();
}

main().catch(console.error);
