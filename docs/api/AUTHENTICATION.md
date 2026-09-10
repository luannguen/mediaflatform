# 🔐 Authentication & Scopes

Media Platform supports dual authentication models:
1. **Developer API Keys**: For backend services, headless integrations, worker daemons, and CI/CD pipelines.
2. **Session Cookies**: For dashboard web users with Supabase Auth.

---

## 1. Using API Keys

Pass the key using either:
- HTTP Header: `X-Media-Api-Key: mda_live_xxxxxxxxxxxxxxxxxxxxxxxx`
- Authorization Bearer: `Authorization: Bearer mda_live_xxxxxxxxxxxxxxxxxxxxxxxx`

### Key Types & Prefixes
- `mda_live_...`: Production workloads
- `mda_test_...`: Staging and test sandboxes

---

## 2. Granular Scopes Registry

Every API key is bounded by an explicit array of scopes. Requests attempting an action outside the key's scopes are rejected with `403 PERMISSION_DENIED`.

| Scope | Category | Description |
| :--- | :--- | :--- |
| `assets:read` | Assets | List, view, download metadata, resolve delivery URLs |
| `assets:write` | Assets | Direct upload, create upload sessions, update metadata |
| `assets:delete` | Assets | Soft delete and permanent asset purge |
| `folders:read` | Taxonomy | View folder hierarchy and contents |
| `folders:write` | Taxonomy | Create, rename, move, delete folders |
| `references:read`| References | View external entity references linked to assets |
| `references:write`| References | Register, attach, and detach external asset references |
| `webhooks:read` | Webhooks | View webhook endpoints and delivery history |
| `webhooks:write`| Webhooks | Register webhooks and trigger manual replays |
| `analytics:read`| Analytics | Query usage, quotas, and access metrics |
| `admin:manage` | Admin | Worker fleet visibility, key rotation, service accounts |

---

## 3. Worker Authentication
Internal worker daemons communicating on the processing queue authenticate with a dedicated `worker_secret` token passed via `X-Worker-Secret`. This header is reserved for internal infrastructure and is never granted to developer API keys.
