# 🔄 MEDIA LIFECYCLE & SAFE DELETE PROTOCOL

---

## 1. Asset State Machine

```text
[ Upload File ]
       │
       ▼
   uploading ──────────► failed
       │
  (SHA-256 Checksum)
       │
       ▼
    active ◄──────────┐
       │               │
  (Move to Trash)  (Restore)
       │               │
       ▼               │
    trashed ───────────┘
       │
  (Safe Delete Check: references == 0?)
       ├─── If references > 0 ──► Blocked: HTTP 409 ASSET_IN_USE
       │
       ▼
    deleted / purged
  (Physical Storage Removed)
```

---

## 2. Safe Delete Protection (The Golden Rule)

External applications register their use of media assets via `asset_references`.

When an asset deletion is requested:
1. System queries `asset_references WHERE asset_id = :id`.
2. If `COUNT > 0` and `force != true`:
   - System **ABORTS** deletion.
   - Throws `AppError.conflict` with error code `ASSET_IN_USE`.
   - Returns details of all consuming applications, entity types, and entity IDs.
3. If `COUNT == 0` or `force == true`:
   - Delete physical object from Storage Provider bucket.
   - Delete variants from `asset_variants`.
   - Delete database record from `assets`.
   - Record audit event `asset.purge`.

---

## 3. Soft Delete (Trash) & Retention

- When moved to trash:
  - `status = 'trashed'`
  - `deleted_at = NOW()`
  - `purge_after = NOW() + INTERVAL '30 days'`
- During retention:
  - Asset is hidden from standard Library view.
  - Can be restored back to `active` at any time with 1-click.
  - Delivery URLs remain functional until physical purge.
