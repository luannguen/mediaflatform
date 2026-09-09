# 🛡️ SECURITY MODEL & ZERO-TRUST ARCHITECTURE

**Standard**: Antigravity Agent Protocol (A.A.P) v3.0  
**Core Law**: Zero-Trust Backend, Strict Server-Side Authorization

---

## 1. Multi-Tenant Isolation Hierarchy

```text
Organization (Tenant Root)
   └── Workspace (Media Boundary)
          ├── Assets (med_...)
          ├── Folders (fld_...)
          ├── Applications (app_...)
          └── API Keys (key_...)
```

- **Server-Side Enforcement**: All database queries MUST include `workspace_id`. Frontend filters are cosmetic; the API Route Handlers enforce workspace ownership through the authenticated `Principal`.
- **Cross-Tenant Denials**: A valid token for `Workspace A` attempting to read, update, or delete an asset in `Workspace B` receives HTTP `403 Forbidden` / `404 Not Found`.

---

## 2. API Key Security (One-Way Hashing)

Media Platform issues API keys formatted as:
```text
mda_[env]_[prefix]_[secret]
```
Example: `mda_live_9fa8b2c1_e827ab49c0d1e2f3...`

### Security Guarantees:
1. **Never Stored in Plaintext**: Only `key_prefix` (for index lookup) and `key_hash` (HMAC-SHA256 with server salt) are persisted in PostgreSQL.
2. **Displayed Once**: The full secret is revealed to the user in the UI dialog **EXACTLY ONCE** upon creation. It is impossible to recover a lost key from the dashboard or database.
3. **Constant-Time Verification**: Comparison is performed using `crypto.timingSafeEqual` to eliminate timing-attack side channels.
4. **Immediate Revocation**: Revoking a key immediately marks `status = 'revoked'` and denies subsequent requests.

---

## 3. Scopes & RBAC Matrix

Tokens must explicitly declare their allowed operational scopes:

| Scope | Allowed Operations |
| :--- | :--- |
| `assets:read` | Read assets, fetch metadata, resolve delivery URLs |
| `assets:write` | Create assets, update title, tags, and move folders |
| `assets:delete` | Soft delete to trash, safe purge |
| `uploads:create` | Ingest new files via multipart uploads |
| `references:read`| Inspect external consumer references |
| `references:write`| Register and sync entity references |
| `folders:*` | Manage hierarchical folders |
| `webhooks:*` | Register endpoints and receive events |

---

## 4. Secrets Management

- `SUPABASE_SERVICE_ROLE_KEY`: Kept strictly server-side in `.env.local` / Vercel Environment Variables. Never bundled into browser assets.
- `API_KEY_SECRET_SALT`: Server-side secret used for HMAC key hashing.
- `STORAGE_CREDENTIALS`: Managed via `StorageProvider` abstraction server-side.
