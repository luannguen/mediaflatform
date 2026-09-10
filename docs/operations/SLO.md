# 🎯 Service Level Objectives (SLO) & Error Budgets

Operational targets and service level indicators for Media Platform v3.8.

---

## 1. Availability SLOs

| Component | Target Availability (Monthly) | Allowable Downtime | Error Budget |
| :--- | :--- | :--- | :--- |
| **API Gateway** | 99.95% | 21.6 minutes | 0.05% |
| **Delivery Engine (CDN)** | 99.99% | 4.32 minutes | 0.01% |
| **Worker Queue Engine** | 99.90% | 43.2 minutes | 0.10% |

---

## 2. Latency SLOs

| Endpoint / Operation | Target p95 Latency | Target p99 Latency |
| :--- | :--- | :--- |
| `GET /api/v1/health/live` | < 5ms | < 10ms |
| `GET /api/v1/health/ready` | < 45ms | < 100ms |
| `GET /api/v1/assets/:id` | < 60ms | < 150ms |
| Direct Image Delivery (Warm CDN) | < 25ms | < 60ms |
| Image Transform (Cold Generation) | < 450ms | < 900ms |
| Webhook Outbound Delivery | < 800ms | < 1500ms |

---

## 3. Incident Management & Error Budget Depletion

If the error budget drops below 20% in a 30-day window:
1. Feature releases are paused; focus shifts to reliability hardening.
2. In-depth post-mortem is documented in `docs/operations/postmortems/`.
3. Worker concurrency is auto-scaled or tuned.
