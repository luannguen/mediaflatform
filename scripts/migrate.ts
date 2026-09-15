// Historical entrypoint now delegates to the checksum-ledger upgrade runner.
// Configure DIRECT_URL or DATABASE_URL in .env.local; no credentials belong in source.
const { migrate } = require('./migrate-production.cjs');
migrate().catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
export {};
