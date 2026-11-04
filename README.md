# Servictro

**Industrial after-sales service & asset operations platform** for LT/HT electrical panel,
switchgear and transformer manufacturers.

Customer → Site → Equipment/Asset → Service Request → Work Order → Technician Assignment
→ Site Visit → Service Report → Maintenance History → AMC / Renewal — in one multi-tenant,
audit-logged system.

```
┌─────────────────────────── Deployment sandbox ───────────────────────────┐
│  Browser → Platform gateway (:81)                                         │
│    ├─ default ──────────────► Next.js 16 web console   (:3000)            │
│    └─ ?XTransformPort=4000 ─► NestJS REST API + worker (:4000)            │
│                                  ├─► PostgreSQL 17 (:5433, RLS enforced)  │
│                                  │    roles: app (RLS) · worker (least    │
│                                  │    privilege) · migrate (DDL only)     │
│                                  └─► local private file storage           │
│                                      + signature malware scanning         │
└───────────────────────────────────────────────────────────────────────────┘
```

## What is implemented

| Area | Highlights |
| --- | --- |
| **Multi-tenancy** | Tenant-scoped Prisma transactions (`set_config('app.tenant_id')`) + PostgreSQL **row-level security** with `FORCE RLS`, non-owner DB role, composite FKs — three isolation layers, negatively tested. |
| **Identity & RBAC** | Email+password (bcrypt-12), 15-min JWT access tokens, rotating refresh tokens (httpOnly cookie, reuse detection), 7-role permission catalog enforced by guards on every route. |
| **Service desk** | Request intake → triage → accept/reject/info-needed → convert to work order, contract-driven coverage resolution, duplicate detection. |
| **Work orders** | Explicit state machine (ADR-017), SLA clocks snapshotted from contracts/tenant defaults, technician assignment, versioned immutable checklists, measurements with range validation, observations, parts, customer acknowledgement, versioned PDF service reports (generate → approve → publish). |
| **Contracts & PM** | Warranty/AMC/service contracts per asset with coverage types, renewal pipeline (90-day window), recurrence-rule PM plans, idempotent planned-visit generation, background worker (transactional outbox). |
| **Analytics** | Every dashboard figure is a live SQL aggregate — open requests, overdue work orders, SLA attainment, technician workload, PM pipeline, asset completeness. No fabricated metrics (ADR-019). |
| **Technician client** | Installable PWA (manifest + service worker + offline page): job pack cached on-device **per user+tenant** (purged on logout/switch), durable offline capture queue with client UUIDs, auto-sync on reconnect/restart (incl. Background Sync), server-authoritative push with atomic idempotency and accepted/duplicate/conflict/rejected results; conflicts/rejections stay queued for explicit review (ADR-008/025). |
| **Security hardening** | Active rate limiting (per-user/IP trackers), object-level file authorization, fail-closed malware scanning, least-privilege worker DB role, signed downloads (HMAC local / S3 presigned), `.env` untracked. |
| **Infrastructure** | Production + dev Dockerfiles, docker-compose (dev & prod), Terraform (VPC/RDS/S3-KMS/ECS/ALB/secrets/alarms), GitHub Actions CI, backup/restore scripts, `/health/worker` monitoring. |
| **Web console** | 15 views (dashboard, requests, work orders, customers, sites, assets w/ QR + documents + timeline, contracts, PM plans, checklist templates, team, notifications, audit, settings, my jobs) — navy/blue enterprise design system, light theme, responsive. |

## Quick start (sandbox)

```bash
bun install                      # workspace deps
bash scripts/pg.sh start         # embedded PostgreSQL 17 on :5433
cd mini-services/serviceos-api
bun run dev                      # migrate → seed (first boot) → API :4000 + worker
# in another shell:
bun run dev                      # Next.js console on :3000
```

Open the preview (or `http://localhost:81` through the gateway). Demo credentials
(dev-only, fictional data — ADR-015):

| Tenant | User | Password |
| --- | --- | --- |
| Aurora Switchgear Pvt. Ltd. | `owner@aurora.example` | `DemoOwner#2026` |
| Aurora Switchgear Pvt. Ltd. | `tech@aurora.example` (technician) | `DemoTech#2026` |
| Voltline Power Systems | `owner@voltline.example` | `DemoOwner#2026` |

Interactive API docs: `http://localhost:4000/api/docs` (Swagger).

## Tests

```bash
cd mini-services/serviceos-api
bun run test        # 111 tests: unit (password, recurrence, state machines,
                    # permissions, AMC expiry, malware scanner)
                    # + API integration (onboarding, tenant isolation,
                    # workflows A–E, mobile sync concurrency, file security,
                    # renewal dedup + worker role, rate limiting, auth security)
bun test src/lib/offline-store.test.ts   # frontend offline-queue semantics
bun run dev:api     # ... while developing
```

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Runtime topology, module map, request lifecycle |
| [`docs/ARCHITECTURE_DECISIONS.md`](docs/ARCHITECTURE_DECISIONS.md) | All ADRs incl. every documented deviation |
| [`docs/DATABASE.md`](docs/DATABASE.md) | Schema, RLS, roles, migrations |
| [`docs/API.md`](docs/API.md) | REST conventions, envelopes, endpoint catalog |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Auth, tenancy, rate limits, file handling, threat model |
| [`docs/DEVELOPMENT_SETUP.md`](docs/DEVELOPMENT_SETUP.md) | Local environment, credentials, troubleshooting |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Production topology (AWS), env matrix, hardening checklist |
| [`docs/REMEDIATION_REPORT.md`](docs/REMEDIATION_REPORT.md) | Engineering audit remediation — issue-by-issue report |

## Status

Phase 0–5 complete (foundation, identity/multi-tenancy, core business, service
operations incl. reports, maintenance, web console + technician PWA) plus the full
engineering-audit remediation (security, data integrity, PWA, production
infrastructure — see [`docs/REMEDIATION_REPORT.md`](docs/REMEDIATION_REPORT.md)).
Analytics and enterprise-readiness hardening continue per the phase plan; see the
ADR log for environment-driven deviations (PWA vs Expo, local storage vs S3,
outbox vs BullMQ).
