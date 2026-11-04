# ServiceOS — System Architecture

ServiceOS is an industrial after-sales service and asset operations SaaS for LT/HT
electrical panel and switchgear manufacturers. The central workflow:

```
Customer → Site → Equipment/Asset → Service Request → Work Order
        → Technician Assignment → Site Visit → Service Report
        → Maintenance History → AMC / Renewal
```

See `docs/ARCHITECTURE_DECISIONS.md` (ADRs) for rationale on every deviation.

## 1. Runtime topology

```
┌───────────────────────────── Deployment sandbox ─────────────────────────────┐
│                                                                              │
│  Browser (user)                                                              │
│    │  same-origin                                                            │
│  Platform gateway (Caddy :81)                                                │
│    ├─ default ────────────────► Next.js 16 web console  (port 3000)          │
│    └─ ?XTransformPort=4000 ──► NestJS REST API           (port 4000)         │
│                                    │                                         │
│                                    ├─► PostgreSQL 17     (port 5433)         │
│                                    ├─► local file storage (data/uploads/)    │
│                                    │                                         │
│  Worker process (NestJS, same codebase, entry worker.ts)                     │
│    └─► polls outbox_events → notifications / PM generation / reports /       │
│        renewal reminders / maintenance rollups                               │
└──────────────────────────────────────────────────────────────────────────────┘

Production target (Tech Spec §20): ECS Fargate (web/api/worker), RDS PostgreSQL
Multi-AZ, ElastiCache Redis+Valkey, S3 private bucket, ALB + CloudFront + WAF,
ap-south-1, Terraform + GitHub Actions OIDC.
```

## 2. Codebase layout

```
/                              # Next.js 16 web console (App Router, TS strict)
├─ src/app/                    # single user-visible route "/" → SPA root
├─ src/instrumentation*.ts     # boots API+worker with the Next server (self-heal)
├─ src/components/app/         # app shell, login, 15 domain views + shared widgets
├─ src/components/ui/          # shadcn/ui primitives (platform-provided)
├─ src/design-system/          # tokens (colour/typography) + enum label/badge maps
├─ src/lib/api/                # typed client (envelope, refresh, XTransformPort) + types
├─ src/lib/auth/store.ts       # zustand session store (token in memory)
├─ src/lib/router.ts           # hash router (deep-linkable #/work-orders/<id>)
├─ packages/contracts/         # shared enums, permission catalog, types
├─ mini-services/serviceos-api # NestJS modular monolith (api + worker entries)
│  ├─ src/main.ts              # REST API entry (port 4000)
│  ├─ src/worker.ts            # background worker entry
│  ├─ src/common/              # prisma, tenant context, guards, filters, pipes
│  ├─ src/modules/<domain>/    # controller / dto / service / repository / policy
│  ├─ prisma/schema.prisma     # full relational model (PostgreSQL)
│  ├─ prisma/migrations/       # reviewed SQL migrations (incl. RLS, roles)
│  └─ test/                    # Jest unit + integration + tenant-isolation suites
├─ scripts/                    # pg lifecycle, api-up, daemonizer, dev helpers
├─ infra/                      # Dockerfiles, docker-compose, Terraform skeleton
├─ docs/                       # this documentation set
└─ .zscripts/dev.sh            # platform boot: pg → migrate → seed → web → api/worker
```

## 3. Backend layering (per module)

| Layer           | Responsibility                                        |
| --------------- | ----------------------------------------------------- |
| `*.controller`  | HTTP ↔ DTO, OpenAPI metadata, guards                  |
| `dto/`          | class-validator request contracts                      |
| `*.service`     | use-cases, business rules, transaction orchestration  |
| `*.repository`  | tenant-scoped Prisma access (always inside tenant tx) |
| `domain/`       | state machines, domain errors, invariants             |
| `common/`       | cross-cutting: auth, tenant context, audit, outbox    |

Request lifecycle (Tech Spec §3.1): JWT auth → membership + tenant resolution →
permission guard → DTO validation → service opens **tenant transaction**
(`set_config('app.tenant_id', …)`) → repository writes → audit + outbox appended in
the same transaction → commit → worker picks up outbox asynchronously.

## 4. Domain modules and dependency order

```
identity/tenancy (auth, tenants, memberships, invitations, RBAC)
   └─► customers (+contacts) ─► sites ─► assets (+documents, QR)
          └─► service-requests ─► work-orders (+assignments, events,
                checklists, measurements, observations, parts, reports)
          └─► contracts (warranty/AMC) ─► maintenance-plans ─► planned-visits
       files (attachments)      notifications        audit
                └────────────► analytics (reads all) ◄────────────┘
```

Build order follows Tech Spec §42: tenancy/security → customers/sites/assets →
requests/work orders → technician execution → reports → contracts/PM → analytics.
No dashboard was built before the workflows that feed it.

## 5. Frontend architecture

- **Single user-visible route** (`/`, per the sandbox preview constraint — ADR-021):
  the console is an SPA mounted at the root with a **hash router** for deep-linkable
  navigation (`#/work-orders/<id>`), loaded through `next/dynamic` with `ssr: false`
  because session state (localStorage, refresh cookie) is client-only.
- **Client Components** throughout; all authoritative business actions go through
  the NestJS API — no Server Actions domain backend.
- **TanStack Query** for server state; **react-hook-form + zod** for forms;
  **TanStack Table** for data tables; **recharts** for charts (with textual
  summaries for accessibility).
- One typed API client (`src/lib/api/client.ts`) handles: bearer token injection,
  automatic single-flight refresh + retry, tenant header, request IDs, error envelope
  mapping, multipart uploads, and the sandbox gateway convention
  (`?XTransformPort=4000` on every relative URL).
- **Auth:** access token in memory only; refresh token in httpOnly SameSite cookie
  (`/api/v1/auth` path); silent refresh on load; memberships carry permission arrays
  hydrated from `GET /auth/me` (login/refresh responses omit them — ADR-021 note).
- **Design system:** single source of tokens (`src/design-system/tokens.ts` +
  Tailwind CSS variables) implementing Tech Spec §7: navy `#0B1F33` navigation,
  blue `#2563EB` primary, semantic status colours, Inter typography scale,
  4px spacing grid, 6/10/14px radii, 44px table rows. Status is never conveyed by
  colour alone (label + icon + tone on every badge). Radix constraint: no
  `SelectItem` may carry an empty-string value — the shared `EnumSelect` maps
  "all/none" options to an internal sentinel.

## 6. Worker responsibilities

| Handler             | Trigger                          | Idempotency                          |
| ------------------- | -------------------------------- | ------------------------------------ |
| notification.send   | outbox event                     | event_id dedupe + delivery record    |
| pm.generate         | schedule (hourly)                | unique (tenant, plan, asset, due_at) |
| renewal.remind      | schedule (daily)                 | unique per contract × horizon day    |
| report.render       | outbox event                     | unique (work_order, report version)  |
| maintenance.rollup  | schedule (daily)                 | upsert by day                        |

All handlers are safe to re-run; failures retry with bounded backoff and surface in
support-visible failure state (spec §14.1, §19.1).

## 7. Observability

Structured JSON request logs with `requestId`/`tenantId`/`userId` (internal) via
pino; health endpoints `/health/live` + `/health/ready` (DB + storage checks);
audit trail for every privileged mutation. OpenTelemetry/Sentry wiring is a
production-deployment task (env-gated; see docs/DEPLOYMENT.md).
