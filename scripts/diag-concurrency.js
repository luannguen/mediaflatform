const fs = require('fs');

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

const { idempotencyService } = require('../src/lib/security/idempotency.ts');
const { supabaseAdmin } = require('../src/lib/supabase/admin.ts');

async function main() {
  console.log('Testing concurrency with 5 requests...');
  const wsId = 'ws_concurrency_race';
  const key = `key_concurrent_${Date.now()}`;
  const route = '/api/v1/assets';
  const payload = { test: 'concurrent_race' };

  console.time('5 concurrent requests');
  const promises = Array.from({ length: 5 }, (_, i) =>
    idempotencyService
      .reserveOrGetCached(wsId, key, route, 'POST', payload)
      .then((res) => ({ i, status: 'success', res }))
      .catch((err) => ({ i, status: 'error', code: err.code, message: err.message }))
  );
  const results = await Promise.all(promises);
  console.timeEnd('5 concurrent requests');
  console.log('Results:', results);

  await supabaseAdmin.from('idempotency_records').delete().eq('workspace_id', wsId).eq('idempotency_key', key);
  console.log('Done.');
}

main().catch(console.error);
