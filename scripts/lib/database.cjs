const fs = require('fs');
const { Client } = require('pg');
const { loadEnvConfig } = require('@next/env');

function databaseClient() {
  loadEnvConfig(process.cwd());
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DIRECT_URL or DATABASE_URL is required');
  const caPath = process.env.PGSSL_ROOT_CERT || (/\.supabase\.(co|com)$/.test(new URL(connectionString).hostname) ? require('path').join(__dirname, '../certs/supabase-ca.crt') : undefined);
  return new Client({
    connectionString,
    ssl: process.env.PGSSL_DISABLE === 'true' ? false : {
      rejectUnauthorized: true,
      ...(caPath ? { ca: fs.readFileSync(caPath, 'utf8') } : {}),
    },
    connectionTimeoutMillis: 15000,
  });
}
module.exports = { databaseClient };
