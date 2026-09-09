import { Client } from 'pg';
import fs from 'fs';
import path from 'path';

async function migrate() {
  const connectionString =
    process.env.DIRECT_URL ||
    process.env.DATABASE_URL ||
    'postgresql://postgres.sxysgtgnygyiouftzjww:dNRVd6e9qD!%403TL@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres';

  console.log('🔄 Connecting to Supabase PostgreSQL at aws-0-ap-northeast-1.pooler.supabase.com:5432...');

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('✅ Connected successfully to Supabase PostgreSQL!');

    const schemaPath = path.join(__dirname, '../supabase/schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');

    console.log('🚀 Executing supabase/schema.sql to provision all 22 tables, indexes, and roles...');
    await client.query(sql);
    console.log('🎉 Schema applied successfully!');

    // Verify tables
    const res = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);

    console.log('\n📊 Tables in public schema:');
    res.rows.forEach((r, i) => console.log(`  ${i + 1}. ${r.table_name}`));
  } catch (err: any) {
    console.error('❌ Migration error:', err.message);
  } finally {
    await client.end();
  }
}

migrate();
