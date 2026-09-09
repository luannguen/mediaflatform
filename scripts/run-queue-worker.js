/**
 * Standalone Background Queue Consumer / Worker Daemon
 * Run via: node scripts/run-queue-worker.js [--once]
 */

const fs = require('fs');
const path = require('path');

// 1. Load environment variables
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

const workerId = `daemon_${process.pid}_${Date.now().toString(36)}`;
const isOnce = process.argv.includes('--once');
const pollIntervalMs = parseInt(process.env.WORKER_POLL_INTERVAL_MS || '3000', 10);

let isRunning = true;
let isBusy = false;

console.log(`[QueueDaemon] Initializing standalone worker daemon: ${workerId}`);
console.log(`[QueueDaemon] Mode: ${isOnce ? 'ONE-SHOT' : 'CONTINUOUS POLLING'} (interval: ${pollIntervalMs}ms)`);

// Handle graceful shutdown
function handleShutdown(signal) {
  console.log(`\n[QueueDaemon] Received ${signal}. Initiating graceful shutdown...`);
  isRunning = false;
  if (!isBusy) {
    console.log('[QueueDaemon] Worker stopped cleanly. Goodbye.');
    process.exit(0);
  } else {
    console.log('[QueueDaemon] Waiting for active job to finish...');
    const timeout = setTimeout(() => {
      console.warn('[QueueDaemon] Force exiting after shutdown timeout.');
      process.exit(1);
    }, 15000);
    timeout.unref();
  }
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

async function startDaemon() {
  const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  let cookieHeader = '';

  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    console.error('[QueueDaemon] Error: ADMIN_EMAIL and ADMIN_PASSWORD must be defined in environment.');
    process.exit(1);
  }

  // Authenticate as system service / admin
  try {
    const loginRes = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_PASSWORD,
      }),
    });

    const setCookies = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [loginRes.headers.get('set-cookie')];
    cookieHeader = setCookies.map((c) => c?.split(';')[0]).filter(Boolean).join('; ');
    if (!loginRes.ok) {
      console.error('[QueueDaemon] Failed to authenticate worker:', loginRes.status);
      process.exit(1);
    }
    console.log('[QueueDaemon] Worker authenticated with system credentials.');
  } catch (err) {
    console.error('[QueueDaemon] Worker authentication error:', err.message);
    process.exit(1);
  }

  while (isRunning) {
    try {
      isBusy = true;
      const processRes = await fetch(`${BASE_URL}/api/v1/jobs/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookieHeader,
        },
        body: JSON.stringify({ worker_id: workerId }),
      });

      if (processRes.ok) {
        const json = await processRes.json();
        const job = json.data?.job;

        if (job) {
          console.log(`[QueueDaemon] ✅ Successfully processed job ${job.id} (Stage: ${job.current_stage}, Output: ${job.output_version || 'v1'})`);
          isBusy = false;
          if (isOnce) break;
          // If a job was processed, immediately check for the next job without sleeping
          continue;
        } else {
          // No job pending in queue
          if (isOnce) {
            console.log('[QueueDaemon] One-shot execution complete: No pending jobs in queue.');
            break;
          }
        }
      } else {
        console.warn(`[QueueDaemon] Process endpoint returned HTTP ${processRes.status}`);
      }
    } catch (err) {
      console.error('[QueueDaemon] Error in polling loop:', err.message);
    } finally {
      isBusy = false;
    }

    if (!isRunning || isOnce) break;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  console.log('[QueueDaemon] Worker daemon cycle finished.');
}

startDaemon().catch((err) => {
  console.error('[QueueDaemon] Fatal worker error:', err);
  process.exit(1);
});
