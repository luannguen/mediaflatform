# Media Platform

Headless digital asset management for CMS, commerce and other applications. The platform owns media, processing and delivery; integrations retain stable asset IDs (med_...). Release **3.8.5**, API **v1**.

The application is a Next.js modular monolith with a separate Node.js worker. PostgreSQL stores tenant data, upload sessions, leases, references, invitations and a webhook outbox. Supabase Storage is the implemented storage backend. Images use Sharp, videos use FFmpeg/FFprobe, and PDFs use PDF.js with a native canvas renderer.

## Run the application

Requires Node.js **22.13 or newer** (validated locally with Node 24.11), an existing Media Platform database through v3.8.4.1, and Supabase Auth/Storage.

```sh
npm ci
# Copy .env.example to .env.local and fill the required server-side settings.
npm run migrate:production -- --dry-run
npm run migrate:production
node scripts/secure-storage.cjs --apply
npm run build
npm start
# Separate supervised process, using the same database and storage:
npm run worker
```

The new migration runner tracks checksums and applies SQL transactionally. It upgrades the existing schema; supabase/schema.sql alone does not provision the historical RPC chain. Preserve a database backup before an upgrade. See the [production runbook](docs/operations/PRODUCTION.md) for configuration, rollout and recovery.

Use npm run dev for local UI development. Register through Supabase Auth and confirm the email before signing in. Configure Supabase SMTP and allowed Auth redirect URLs. Environment admin passwords and role-based quick sign-in are no longer accepted.

## Media lifecycle

1. Create a durable upload session with the declared filename, MIME type and exact byte length.
2. Send bytes directly to the signed Storage URL. Never send a Media API key to Storage.
3. Complete the session. PostgreSQL atomically commits the pending asset and processing job.
4. The worker verifies source size, magic bytes and SHA-256, then generates real outputs and publishes only while holding the current lease/run.
5. Deliver through /api/v1/delivery/{id} or the video gateway. Private/workspace media requires authorization or a scoped delivery grant. Pending assets return HTTP 425.

Upload sessions last 24 hours; signed PUT capabilities last two hours. Images are bounded at 25 MiB, video at 500 MiB and PDFs at 50 MiB; the storage plan may impose a lower limit. Unsupported files stay quarantined. Resumable TUS, audio processing and alternative R2/S3 adapters are not implemented.

Trash is reversible through POST /api/v1/assets/{id}/restore. Permanent purge checks references, fences workers and inventories nested artifacts before deleting database records. A failed storage deletion remains retryable. Trashed assets are not deliverable.

## SDK and connectors

```sh
npm run build:sdk
npm pack ./packages/sdk
```

The package produces CJS, ESM and TypeScript declarations; this repository change does not publish it to npm. Both SDK upload entrypoints use durable sessions for small and large files. Mutation retries require replay safety; list operations retain pagination totals.

WordPress and Strapi connectors use signed PUT sessions as well. Their source was updated, but installation in actual CMS deployments must be verified before upgrading those integrations.

## Verification

```sh
npm run lint
npm run typecheck
npm test
npm run test:openapi
npm run build:sdk
npm run build
npm audit --omit=dev
# Require configured Supabase; use an isolated test/staging project for routine runs:
npm run test:database
# Start application on localhost:3100, then:
npm run test:integration
```

Database tests roll back their fixture transaction. HTTP/media tests create isolated users/workspaces, run only their own jobs and remove their objects afterward. Never run the older versioned integration/seed scripts against a live project as a general smoke test.

See [verified changes and remaining validation](docs/PRODUCTION-UPDATE.md), [project context](docs/PROJECT-CONTEXT.md) and [changelog](CHANGELOG.md). Historical guides describe earlier releases; the production runbook records compatibility changes in 3.8.5.
