// Load configuration before evaluating any shared service modules.
require('@next/env').loadEnvConfig(process.cwd());
require('tsx/cjs');
require('./queue-worker.ts');
