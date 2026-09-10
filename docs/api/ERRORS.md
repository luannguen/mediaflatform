# 🚨 Standard API Error Catalog

All Media Platform error responses follow a consistent, machine-readable envelope with standard HTTP status codes, structured error identifiers, and tracing `request_id`.

```json
{
  "success": false,
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "Operation forbidden for this resource.",
    "request_id": "req_1j8m4k9a1b2c3",
    "details": {}
  }
}
```

---

## Error Codes Reference

| Error Code | HTTP Status | Description | Suggested Client Action |
| :--- | :--- | :--- | :--- |
| `AUTH_REQUIRED` | 401 | Missing authentication credentials (`X-Media-Api-Key` or session). | Supply valid API key or login session. |
| `INVALID_API_KEY` | 401 | The supplied API key token is malformed or invalid. | Verify environment variables and API key string. |
| `API_KEY_REVOKED` | 401 | The API key was revoked by an administrator. | Rotate or generate a new API key. |
| `API_KEY_EXPIRED` | 401 | The API key passed its expiration timestamp or grace period. | Switch to the newly rotated API key. |
| `PERMISSION_DENIED` | 403 | Caller lacks required scope or workspace ownership. | Check key permissions in developer console. |
| `ASSET_NOT_FOUND` | 404 | Asset ID does not exist or has been deleted. | Check asset ID or restore from trash. |
| `WORKSPACE_NOT_FOUND` | 404 | Workspace identifier does not exist. | Ensure correct workspace context. |
| `NOT_FOUND` | 404 | Generic resource not found. | Verify resource endpoint path. |
| `RESOURCE_CONFLICT` | 409 | Name collision, concurrent edit, or duplicate entity. | Retry or rename resource. |
| `ASSET_IN_USE` | 409 | Permanent deletion blocked due to active external references. | Detach external references before permanent delete. |
| `IDEMPOTENCY_CONFLICT` | 409 | Re-used `Idempotency-Key` with differing request payload. | Generate unique idempotency key for distinct actions. |
| `VALIDATION_ERROR` | 422 | Request body failed schema validation. | Inspect `details` object for field errors. |
| `UPLOAD_TOO_LARGE` | 413 | File payload exceeds maximum allowed size or plan quota. | Compress or check workspace plan limits. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | File format is not supported for processing. | Convert to supported audio/video/image format. |
| `RATE_LIMIT_EXCEEDED` | 429 | Caller exceeded rate limit window. | Inspect `Retry-After` header and backoff. |
| `INTERNAL_ERROR` | 500 | Unexpected server fault. | Contact support with `request_id`. |

---

## Client Error Handling Pattern

```typescript
import { MediaPlatformError } from '@media-platform/sdk';

try {
  await media.assets.delete(assetId, { permanent: true });
} catch (err) {
  if (err instanceof MediaPlatformError) {
    if (err.code === 'ASSET_IN_USE') {
      console.warn('Cannot delete asset in use:', err.details.references);
    } else if (err.code === 'RATE_LIMIT_EXCEEDED') {
      console.warn('Rate limited, backing off...');
    }
  }
}
```
