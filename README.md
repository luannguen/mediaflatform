# 🎬 Media Platform

> Enterprise Headless Digital Asset Management (DAM) & Distributed Media Processing Engine.

[![Version](https://img.shields.io/badge/version-v3.8.2-blue.svg)](CHANGELOG.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6.svg)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15-black.svg)](https://nextjs.org/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL%2016-3ECF8E.svg)](https://supabase.com/)

---

## 🌟 Architecture Overview

Media Platform is a modern, headless digital asset platform engineered for high-concurrency environments. It manages the complete lifecycle for images, multi-bitrate HLS video, PDFs, and ZIP archives.

### Core Capabilities:
- **Distributed Media Pipeline**: Single Source of Truth `MediaWorkerCore` with CAS (Compare-And-Swap) state transitions, crash recovery, and adaptive FFmpeg ladders.
- **On-the-fly Image Processing**: Dynamic WebP/AVIF transformations with smart focal-point cropping and decompression bomb protection.
- **Multi-Tenant Fencing**: Cryptographic API keys with granular scopes, organization/workspace fencing, and service account isolation.
- **Safe Delete Protection**: Atomic external reference synchronization that blocks destructive deletions (`ASSET_IN_USE`).
- **Developer Platform & Operational Control Plane (v3.8)**:
  - Machine-readable **OpenAPI 3.1** specification (`/api/openapi.json`).
  - **Official TypeScript SDK** (`@media-platform/sdk`) with retries, jitter, and idempotency.
  - **3-Tier Health Probes**: `/health/live`, `/health/ready`, `/health/deep` with live storage probes.
  - **Zero-Downtime API Key Rotation**: Smooth key replacement with overlapping grace periods.
  - **Idempotency & Rate Limiting**: Token-bucket sliding window limiter and SHA-256 payload caching.
  - **Worker Fleet Observability**: Heartbeat tracking, active worker status, and stale daemon recovery.

---

## 📦 Client SDK

```bash
npm install @media-platform/sdk
```

```typescript
import { MediaPlatformClient } from '@media-platform/sdk';

const media = new MediaPlatformClient({
  apiKey: process.env.MEDIA_API_KEY!,
  baseUrl: 'https://media.yourdomain.com'
});

// Upload and deliver
const asset = await media.assets.upload(fileBuffer, { displayName: 'Product Hero' });
const cdnUrl = media.assets.getDeliveryUrl(asset.id, { width: 800, format: 'webp' });
```

---

## 🧭 Documentation Map

| Guide | Description |
| :--- | :--- |
| [🚀 Quick Start](docs/guides/QUICK-START.md) | Onboarding guide for SDK and REST APIs |
| [🔌 External Integration Guide](docs/integration-guide/INTEGRATION-GUIDE.md) | Architectural rules and reference sync patterns |
| [🔐 Authentication & Scopes](docs/api/AUTHENTICATION.md) | API keys, scopes registry, and security model |
| [🔁 Idempotency Guide](docs/api/IDEMPOTENCY.md) | Safe mutation replays via `Idempotency-Key` |
| [🚨 Error Catalog](docs/api/ERRORS.md) | Complete reference of machine error codes and remedies |
| [🔑 Key Rotation Guide](docs/guides/API-KEY-ROTATION.md) | Zero-downtime secret rotation runbook |
| [🔔 Webhooks Guide](docs/guides/WEBHOOKS.md) | Event subscriptions and safe replay protocol |
| [🩺 Health & Readiness](docs/operations/HEALTH.md) | Probe endpoints for Kubernetes and uptime monitors |
| [⚙️ Worker Fleet Operations](docs/operations/WORKERS.md) | Transcoder daemon lifecycle, leasing, and recovery |
| [📊 Telemetry & Metrics](docs/operations/METRICS.md) | Usage metrics, audit logging, and redaction |
| [🎯 SLOs & Targets](docs/operations/SLO.md) | Latency percentiles and availability targets |
| [🗄️ Data Model](docs/data-model/DATA-MODEL.md) | PostgreSQL schema dictionary and ERD |

---

## 🛠️ Local Development

### Prerequisites
- Node.js 18+ (Tested on Node.js 24)
- Supabase Project or local PostgreSQL instance with Storage enabled

### Setup
```bash
# Clone the repository
git clone https://github.com/luannguen/mediaflatform.git
cd mediaflatform

# Install dependencies
npm install

# Configure environment
cp .env.example .env.local

# Run database migrations
node scripts/migrate-v3-8-developer-platform.js

# Start development server
npm run dev

# Start queue processing worker daemon
npm run worker
```

---

## 🧪 Testing

Run comprehensive integration test suites:

```bash
# v3.8 Developer Platform & Control Plane Test Suite
node scripts/test-v3-8-developer-control-plane.js

# Prior Regression Suites
node scripts/test-v3-7-asset-platform-hardening.js
node scripts/test-v3-6-multi-tenant-fencing.js
node scripts/test-v3-5-hardened-pipeline.js
node scripts/test-landingtest-video-studio.js
```

---

## 📄 License

MIT © Media Platform Team
