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

  const users = await client.query('SELECT count(*) as count FROM auth.users');
  const userList = await client.query('SELECT id, email, raw_user_meta_data FROM auth.users ORDER BY created_at DESC');
  const workspaces = await client.query('SELECT id, name, slug, organization_id, status FROM workspaces');
  const orgs = await client.query('SELECT id, name, slug FROM organizations');
  const memberships = await client.query('SELECT * FROM workspace_memberships');
  const roles = await client.query('SELECT id, key FROM roles');
  const folders = await client.query('SELECT id, workspace_id, name, slug FROM folders');

  console.log('--- DATABASE STATE AUDIT ---');
  console.log('Auth Users Total:', users.rows[0].count);
  console.log('Users list:', userList.rows.map(u => ({ id: u.id, email: u.email, role: u.raw_user_meta_data?.role, name: u.raw_user_meta_data?.full_name })));
  console.log('Workspaces Total:', workspaces.rows.length, workspaces.rows);
  console.log('Organizations Total:', orgs.rows.length, orgs.rows);
  console.log('Memberships Total:', memberships.rows.length, memberships.rows);
  console.log('Roles in DB:', roles.rows.map(r => `${r.key} (${r.id})`));
  console.log('Folders Total:', folders.rows.length, folders.rows);

  // Check orphans: auth users with no membership
  const memberUserIds = new Set(memberships.rows.map(m => m.user_id));
  const orphans = userList.rows.filter(u => !memberUserIds.has(u.id));
  console.log('Orphan users count:', orphans.length);
  console.log('Orphan users:', orphans.map(o => ({ id: o.id, email: o.email })));

  await client.end();
}

main().catch(console.error);
