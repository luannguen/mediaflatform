# 🏛️ SYSTEM ARCHITECTURE & DOMAIN MODEL

**Platform**: Independent Digital Asset Management (DAM) Service  
**Deployment**: Vercel (Next.js 15 App Router, Serverless Functions)  
**Persistence & Storage**: Supabase (PostgreSQL 16, Supabase Storage, Row Level Security)  
**Security Model**: Zero-Trust Multi-Tenancy, SHA-256 Key Hashing, Role-Based Access Control

---

## 1. High-Level Topology

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            EXTERNAL CLIENTS                                 │
│  Main Platform (Next.js) │ Commerce (Vite) │ Community (React) │ AI Agents  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ (REST API v1 with Header X-Media-Api-Key)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         VERCEL EDGE & SERVERLESS                            │
│                                                                             │
│   ├── /api/v1/assets         (List, Read, Metadata, Safe Delete)           │
│   ├── /api/v1/uploads        (Multipart Ingest, SHA-256 Hash, Quotas)      │
│   ├── /api/v1/references     (Usage Registration & Atomic Sync)            │
│   └── /api/v1/developer      (Application & API Key Lifecycle)             │
│                                                                             │
│   Security Layer: Scope Guard, Rate Limit, Error Envelopes, Request Tracing │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MODULAR MONOLITH CORE                               │
│                                                                             │
│   ├── AssetService           ├── ReferenceService   ├── DeveloperService    │
│   ├── StorageProvider        ├── FolderService      ├── CollectionService   │
│   └── LifecycleService       ├── AuditService       └── UsageService        │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                      ┌────────────────┴────────────────┐
                      ▼                                 ▼
┌───────────────────────────────────────────┐  ┌──────────────────────────────┐
│            STORAGE ADAPTER                │  │     POSTGRESQL (SUPABASE)    │
│  Interface: StorageProvider               │  │  - 22 Relational Tables      │
│  ├── SupabaseStorageProvider (active)     │  │  - Foreign Key Constraints   │
│  ├── CloudflareR2Provider (ready)         │  │  - SHA-256 Indexed Keys      │
│  └── AWSS3Provider (ready)                │  │  - Row Level Security (RLS)  │
└───────────────────────────────────────────┘  └──────────────────────────────┘
```

---

## 2. Prefixed Identifiers (UUID / Base36 Clean Convention)

All system entities use human-readable, debug-friendly prefixes:
- `med_...`: Media Assets
- `fld_...`: Hierarchical Folders
- `col_...`: Curated Collections
- `tag_...`: Semantic Tags
- `app_...`: Registered Applications
- `svc_...`: Service Accounts
- `key_...`: Issued API Keys
- `ref_...`: Asset References (Usage Tracking)
- `upl_...`: Upload Sessions
- `job_...`: Background Processing Jobs
- `req_...`: API Request Correlation ID
- `evt_...`: Audit Trail Events
- `ws_...`: Multi-Tenant Workspaces
- `org_...`: Organizations

---

## 3. Storage Abstraction Layer

The media storage is abstracted via `StorageProvider`:

```typescript
export interface StorageProvider {
  readonly name: string;
  upload(data: Buffer, key: string, mimeType: string, bucket?: string): Promise<StorageUploadResult>;
  delete(key: string, bucket?: string): Promise<boolean>;
  getSignedDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  getPublicUrl(key: string): string;
  exists(key: string): Promise<boolean>;
}
```

This guarantees zero lock-in to any single vendor. If the organisation later switches from Supabase Storage to Cloudflare R2 or AWS S3, only a new provider class needs to be registered.
