# 📑 REST API V1 SPECIFICATION & CONTRACTS

**Base URL**: `https://your-media-domain.vercel.app/api/v1`  
**Authentication Header**: `X-Media-Api-Key: mda_live_xxxxxxxxxxxxxxxxxxxxxxxx`  
**Response Envelope**:
- Success: `{ "data": ..., "meta": { "request_id": "req_...", "timestamp": "..." } }`
- Error: `{ "error": { "code": "...", "message": "...", "request_id": "req_..." } }`

---

## Endpoints Directory

### 1. System Health
- **`GET /health`**
  - Response: `{ "status": "healthy", "version": "1.0.0" }`

### 2. Assets (`assets:read`, `assets:write`, `assets:delete`)
- **`GET /assets`**: List assets with pagination and filters.
  - Query Params: `folder_id`, `type`, `status`, `search`, `page`, `limit`, `sort`.
- **`GET /assets/:id`**: Fetch asset details, dimensions, and resolved storage URL.
- **`PATCH /assets/:id`**: Update display name, description, metadata.
- **`DELETE /assets/:id`**: Soft delete (`?action=trash`) or Safe Purge (`?action=purge&force=false`).
  - *Returns HTTP 409 `ASSET_IN_USE` if active external references exist.*

### 3. Uploads (`uploads:create`)
- **`POST /uploads`**: Multipart form data upload (`file`, `display_name`, `folder_id`, `visibility`).
  - Automatically generates SHA-256 checksum and checks for duplicate content.

### 4. References & Safe Delete (`references:read`, `references:write`)
- **`GET /assets/:id/references`**: List all external consumers of an asset.
- **`POST /references`**: Register a single reference (`source_app`, `entity_type`, `entity_id`, `field_name`).
- **`POST /references/sync`**: Atomic sync of multiple references for a given entity.
- **`DELETE /references?id=ref_xxx`**: Deregister reference.

### 5. Organization (`folders:*`, `collections:*`, `tags:*`)
- **`GET /folders`** & **`POST /folders`**: Manage hierarchical folders.
- **`GET /tags`** & **`POST /tags`**: Manage semantic normalized tags.

### 6. Developer & Integration (`apikey:*`, `application:*`)
- **`GET /developer/apps`** & **`POST /developer/apps`**: Register external applications.
- **`GET /developer/keys`**: List issued API keys (masked with prefix).
- **`POST /developer/keys`**: Issue new API key (reveals raw secret once).
- **`DELETE /developer/keys?id=key_xxx`**: Immediately revoke API key.

### 7. Webhooks & Telemetry (`webhooks:*`, `audit:read`)
- **`GET /webhooks`** & **`POST /webhooks`**: Manage webhook endpoints and signing secrets.
- **`GET /audit`**: View immutable audit trail events.
