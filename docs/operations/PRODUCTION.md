# Production runbook — 3.8.5

## Runtime and trust boundaries

Run Next.js and a separately supervised Node worker with the same release, database and private Storage bucket. Node 22.13+ is required; this release was exercised on Windows/Node 24.11. Linux packaging is checked by CI. Install dependencies with `npm ci`, including the platform-specific FFmpeg/FFprobe, Sharp and canvas binaries. Keep `scripts/render-pdf-preview.mjs` and PDF.js resources with the worker. Serverless HTTP time limits make `/jobs/process` unsuitable as the durable daemon transport; `--http` is rejected.

Supabase is the only implemented storage adapter. RLS and revoked public grants prevent `anon`/`authenticated` clients from reading application tables or executing privileged RPCs. The API uses service role and therefore **must** enforce tenant and scope checks; RLS is not a second tenant check for that role. Never expose service-role credentials in a browser or connector bundle. The bucket must be private; public assets are published through the authorized delivery gateway, not public bucket URLs.

Use verified Supabase Auth identities. Membership roles are read from PostgreSQL at request time. Registration follows the project's email-confirmation policy; configure SMTP and allowed Auth redirects separately. Invitations persist and are matched to the current verified email on acceptance. Invitation email sending is not implemented; invitees see their pending invitations after login. Existing orphan memberships do not grant access to nonexistent identities.

Configure the variables in `.env.example`. Use independent session, API-key salt, delivery-grant and worker secrets. Existing signing fallbacks to service role remain compatible, but rotate into independent secrets during a coordinated deployment. Changing the API key salt invalidates existing key hashes; reissue keys when doing that migration. Demo access requires an explicitly selected demo workspace with `settings.demo=true` and a verified configured demo user. Development bypasses/mocks require explicit test-mode flags and are unavailable in production.

## Upgrade and rollback

The baseline for this upgrade is the project's database through v3.8.4.1. The historical schema/RPC scripts are not a supported fresh-project installer. Preserve a recoverable database backup and the matching release artifact before an upgrade.

1. Stop old workers so they cannot publish through obsolete code.
2. Run `npm run migrate:production -- --dry-run`, then `npm run migrate:production`. The runner uses TLS certificate verification, a transaction, an advisory lock and a checksum ledger. Never edit an applied migration; add a new SQL file.
3. Run `node scripts/secure-storage.cjs --apply` to make the bucket private. Existing direct public bucket URLs stop working; use asset IDs and gateway URLs in clients.
4. Deploy the API/dashboard and worker from the same commit; start `npm run worker` under a restart-on-failure process supervisor.
5. Check health, authenticate with a real account, upload a fixture and wait for actual verified output. Confirm the worker fleet heartbeat and webhook queue progress.

Rollback should stop workers and deploy a compatible application release while retaining the expanded schema. Do not reopen public table/bucket access or drop migration data as a rollback shortcut. New RPCs require verified source checksums and exact run IDs; pre-3.8.5 workers are not compatible with these publish checks. Recover forward when old code cannot honor the new invariants.

## Upload, delivery and cleanup

All maintained upload clients use durable sessions. Legacy multipart is limited to 4 MiB and enters the same session/job pipeline. Presigned/confirm aliases map to a reserved asset ID. Pre-upgrade incomplete uploads without a session return 409; restart those uploads. Manual `POST /assets` with arbitrary storage keys is rejected.

Session lifetime is 24 hours. Supabase signed PUT lifetime is two hours, including capability refreshes; refresh does not extend session expiry. Cleanup waits two additional hours after session expiration, so late-issued capabilities cannot recreate an object after cleanup. Failed deletions retain a pending status for retry; completed cleanup is excluded from subsequent batches. The continuous unscoped worker runs cleanup once per minute. `--once` and `--workspace-id` runs do not clean other workspaces.

Pending image/video/PDF assets return 425 at delivery. A worker downloads through the configured storage provider, enforces exact size, inspects magic bytes/SVG content and computes SHA-256 before publication. Client checksums and provider ETags are declarations, not proof. The publication RPC checks the current lease/run and verified checksum, and rejects trashed or purging assets. Images are capped at 16 Mi-pixels; PDFs render in a separate process with time and memory bounds. Failed FFmpeg output is an error, never a synthetic poster.

Private delivery uses `no-store`. Public delivery requires revalidation so a visibility change or rollback takes effect at the stable URL. Public media caching therefore favors revocation correctness over long CDN TTLs. Previously downloaded files cannot be recalled. SVG originals require explicit download and are sandboxed; inline previews are rasterized.

Purge inventories originals, versions and nested image/video/document/transform outputs. Any inventory/delete failure keeps the asset in durable `purge_pending`; retry the same purge. Processing jobs are fenced and given a five-minute grace period before deleting outputs. Restore is rejected once purge begins. References block purge unless the caller has authorized force-purge privileges. Do not manually remove the database row while Storage deletion is incomplete.

## Request replay, webhooks and operations

All API routes use the shared request wrapper for request IDs, bounded bodies, origin checks, applicable rate limiting and tenant-aware logs. Configure the reverse proxy to replace untrusted `X-Forwarded-For` values. Credential-issuing mutations reject `Idempotency-Key`, including auth, API keys, webhook registration, upload capabilities and delivery grants.

For ordinary mutations a key is scoped to actor, role/scopes, workspace, method, route and payload. Completed responses replay. Once execution begins, an expired lease does not authorize another execution. A crash between a committed side effect and saving its response leaves an ambiguous operation blocked. Reconcile its target resource and request logs before operator intervention; never delete a blocked record and blindly retry with a fresh key.

Asset events enter `webhook_deliveries` in the same transaction as asset changes. The worker claims deliveries, signs the exact JSON body with HMAC-SHA256, and sends `X-Media-Signature`, `X-Media-Event-Id` and `X-Media-Delivery`. Consumers must verify the raw body and deduplicate by event ID: delivery is at least once, including manual replays. Retries use exponential backoff with up to eight attempts. Replays create a new delivery row while retaining the event ID and original record.

Webhook destinations require HTTPS/443, a public IPv4 DNS result, no URL credentials, no redirects and bounded DNS/network waits. IPv6-only endpoints are not supported. Endpoint signing secrets are returned once on registration, excluded from listing, and stored server-side for HMAC signing. Database backups containing them must be protected as credentials.

Analytics aggregates the full selected window (up to 30 days) in PostgreSQL; recent-event details are limited to 20 and top assets to 10. It measures recorded events, not billable provider bandwidth. It is not a financial billing ledger. Logs/metrics/outbox retention and backups should be configured for the deployment's traffic and retention policy; this release does not impose destructive retention on existing data.

## Verification and evidence

Use the commands in the root README. `test:database` rolls back all its fixtures; `test:integration` requires a local application and creates/deletes isolated test users, workspaces and objects. It never drains the existing queue or sends external webhook messages. An interrupted integration run can leave only that run's `test_ws_*`/`test_other_*` fixture graph; inspect those exact IDs before cleanup.

The release checks do not establish load/SLO compliance, SMTP delivery, actual WordPress/Strapi installation, external webhook receiver compatibility, backup restoration or a continuously hosted production worker. Validate those in the target deployment. See [release evidence](../PRODUCTION-UPDATE.md).

Official dependency references: [Supabase signed uploads](https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl), [Next.js server package externalization](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages), [setup-node](https://github.com/actions/setup-node), [checkout](https://github.com/actions/checkout).
