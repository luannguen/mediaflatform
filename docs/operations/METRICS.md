# 📊 Telemetry, Metrics & Observability

Media Platform features zero-mock operational telemetry and audit logging.

---

## 1. Real Usage & Quota Service (`GET /api/v1/usage`)

Unlike mock analytics, `usageService` computes ground-truth statistics across real assets and workspaces:
- **Storage**: Real summed `size_bytes` of active and trashed assets vs allocated plan quota.
- **Bandwidth**: Cumulative egress bytes for the billing period.
- **Asset Breakdown**: Real counts grouped by `image`, `video`, `document`, and `archive`.
- **Empty Workspaces**: Returns genuine zeros (`0 bytes`, `0 assets`). No synthetic fake data is injected in production.

---

## 2. API Request Logging (`GET /api/v1/developer/logs`)

All incoming authenticated API calls are recorded in `api_request_logs`:
- Endpoint path & HTTP method.
- Response HTTP status code and response size in bytes.
- Request duration in milliseconds (`duration_ms`).
- Tracing identifier (`request_id`).
- Associated API Key ID (`api_key_id`) and Workspace ID.
- IP address and User Agent.

### Log Redaction & Sanitization
All request queries, headers, and bodies undergo centralized redacting (`src/lib/platform/requestContext.ts`). Credentials, tokens (`token`, `password`, `key`, `secret`), and authorization headers are replaced with `[REDACTED]` prior to persistence.
