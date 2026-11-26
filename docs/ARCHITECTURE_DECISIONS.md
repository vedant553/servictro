# ServiceOS — Architecture Decision Records

This document records every significant architecture decision, including all conflicts
identified between the three project documents (Product Blueprint v1.0, Technical
Architecture & Engineering Specification v1.0, Customer Validation Kit) and between the
documents and the actual development environment. Decisions follow the mandated
hierarchy: **Product Blueprint** (product scope truth) → **Technical Architecture
Specification** (engineering truth) → **Customer Validation Kit** (market context).

---

## ADR-001 — Modular monolith with explicit domain modules

**Status:** Accepted (mirrors Tech Spec §2.1, §3)
**Decision:** One NestJS application containing domain modules (identity, tenants,
customers, sites, assets, files, service-requests, work-orders, checklists, contracts,
maintenance, notifications, audit, analytics). The API and the background worker are two
process entrypoints from the same codebase (`src/main.ts`, `src/worker.ts`), deployable
as separate containers.
**Alternatives rejected:** Microservices (premature — single team, transactional
workflows); Supabase-only backend (rejected by Tech Spec §2.4).

## ADR-002 — Repository layout adapted to the deployment sandbox

**Status:** Accepted (deviation from Tech Spec §5, documented)
**Decision:** The engineering specification prescribes a pnpm+Turborepo monorepo with
`apps/web`, `apps/api`, `apps/worker`, `apps/mobile`. The deployment sandbox mandates a
root-level Next.js application served on port 3000 by a platform-managed dev script, and
expects backend services under `mini-services/` (each an independent package started in
the background and reachable through the platform gateway via an `XTransformPort`
query parameter).
**Resolution:** the platform layout is used, preserving the spec's *logical* structure:

| Spec (§5)             | This repository                        | Notes                                        |
| --------------------- | -------------------------------------- | -------------------------------------------- |
| `apps/web`            | `/` (root Next.js 16 app)              | Port 3000, platform-managed                  |
| `apps/api`            | `mini-services/serviceos-api`          | Port 4000 (API entrypoint)                   |
| `apps/worker`         | `mini-services/serviceos-api` (`worker.ts`) | Separate process, same codebase (spec §3.1) |
| `apps/mobile`         | deferred — see ADR-012                 |                                              |
| `packages/contracts`  | `packages/contracts`                   | Shared enums/types only                      |
| `packages/design-tokens` | `src/design-system/` (in web app)   | Tailwind 4 CSS variables + TS tokens         |
| `infra/`, `docs/`, `scripts/` | unchanged                       |                                              |

Bun workspaces replace pnpm (platform tooling); Turborepo is deferred —
`bun run --filter` / per-service scripts are the equivalent task runner for now
(spec allows "or an equivalent task runner"). **Revisit when CI caching is needed.**

## ADR-003 — PostgreSQL 17 as the system of record (local: embedded binaries)

**Status:** Accepted (mirrors Tech Spec §11)
**Decision:** PostgreSQL is the only system of record. The sandbox cannot run Docker or
system PostgreSQL, so local development uses real PostgreSQL 17 binaries from the
`@embedded-postgres/linux-x64` npm package, managed by `scripts/pg.sh`
(initdb → pg_ctl start/stop on port 5433, data under `.pgdata/`). Production uses RDS
PostgreSQL (§20.2). The Prisma datasource points at PostgreSQL in every environment —
**no SQLite fallback**, because row-level security, composite foreign keys and partial
indexes are non-negotiable multi-tenant controls.

## ADR-004 — Prisma 6.19 LTS line + reviewed SQL migrations

**Status:** Accepted (compatible with Tech Spec §2.1 "Prisma stable release line")
**Decision:** Prisma 6.19.3 (latest stable 6.x, actively supported). Prisma 8.x is a
release candidate (spec §2.2 forbids RC packages in production); Prisma 7's new
generator/config model is viable but adds integration risk with the CommonJS NestJS +
Jest toolchain in this environment.
**Migrations:** generated via `prisma migrate dev --create-only`, then reviewed and
extended with hand-written SQL for everything Prisma cannot express: CHECK constraints,
partial indexes, row-level security policies, FORCE RLS, roles/grants and
`ALTER DEFAULT PRIVILEGES`. Migrations are immutable once applied (spec §5.2).
**Revisit:** upgrade to Prisma 7+ as an isolated task once the domain is stable.

## ADR-005 — Multi-tenant isolation: tenant-scoped transactions + PostgreSQL RLS

**Status:** Accepted (mirrors Tech Spec §15.2/§15.3, Blueprint §13)
**Decision:** Three enforcement layers, in order:
1. **Application layer:** every repository query runs inside a tenant-scoped Prisma
   interactive transaction that first executes `SELECT set_config('app.tenant_id',
   <verified-tenant-uuid>, true)`. The tenant id is resolved from the authenticated
   JWT + `tenant_memberships` lookup — never from a client-supplied value.
2. **Database layer:** RLS with `FORCE ROW LEVEL SECURITY` on every tenant-owned table,
   policies `USING/WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)`.
   The API connects with a **non-owner role** (`serviceos_app`); migrations run as the
   owner role. Transaction-local settings prevent pooled-session leakage (spec warning §15.3).
3. **Relational layer:** composite foreign keys `(tenant_id, child_id)` →
   `(tenant_id, id)` prevent cross-tenant references at write time.

`X-Tenant-Id` headers are accepted only as a *hint* for users with multiple memberships
and are always validated against membership before use. Cross-tenant access is covered
by an automated negative test suite (`tenant-isolation.spec.ts`).

## ADR-006 — Local credentials with an OIDC-ready identity abstraction

**Status:** Accepted (deviation from Tech Spec §15.1, documented)
**Conflict:** Tech Spec §15.1 mandates an OIDC-compatible managed identity provider;
the Blueprint §13 also recommends managed IdP ("avoid building password infrastructure").
The environment has no external IdP credentials.
**Decision:** Email + password authentication implemented locally: bcrypt hashing
(cost 12), short-lived JWT access tokens (15 min) + rotating refresh tokens (stored
hashed, httpOnly SameSite cookie), session revocation. The `users` table already carries
`identity_issuer`/`identity_subject` per the spec so an external IdP (Auth0/WorkOS/Cognito)
can be introduced without domain changes; `AuthService` exposes an internal port for that
swap. This satisfies the user instruction: "Password hashing where credentials are
managed locally" + "create a clean adapter … and document the limitation".
**Limitation:** MFA and password-reset email flows require the external provider; not
available in the sandbox.

## ADR-007 — Warranty/AMC entitlement lives in contracts, not asset free-text

**Status:** Accepted (conflict between Blueprint and Tech Spec)
**Conflict:** Blueprint AST-01 asks for "commissioning and warranty fields" on the asset
and its §12 entity table lists "Warranty start/end" as asset fields; Tech Spec §11.2 and
Blueprint §12 data-modelling rules state warranty coverage must be a contract link and
"do not duplicate contract terms in free-text fields".
**Resolution:** the more specific and technically sound requirement wins (user rule §2):
assets store `commissioning_date`; warranty entitlement is a `service_contracts` row
(`contract_type = 'warranty'`) linked to assets through `contract_assets`. The asset UI
*surfaces* warranty status by contract lookup, preserving the Blueprint's user-facing
outcome without duplicating terms.

## ADR-008 — Technician client: mobile-first PWA now, Expo native app later

**Status:** Accepted (documented conflict between Blueprint §10 and Tech Spec §8)
**Conflict:** The Tech Spec mandates an Expo/React Native app with SQLite offline-first
sync as the technician client. The Blueprint §10 recommends a responsive, installable
**PWA for the first pilot** and defers React Native unless device testing proves native
capabilities are required; the Validation Kit §8 similarly defers "full native app if a
responsive PWA proves sufficient".
**Resolution:** Phase 5 is implemented as a **mobile-first, installable PWA** (Blueprint
position, which the product-scope hierarchy favours for the pilot), with the backend
already exposing the server-authoritative job-pack and sync-push contract designed for
the future native client (Tech Spec §8.5: `operationId`, `baseVersion`, conflict results).
The sandbox cannot run Android/iOS toolchains, so an Expo shell cannot be executed or
tested here; shipping untested native code would violate the "never claim it works
unless tested" rule. **Offline behaviour in the PWA:** assigned job pack cached in
localStorage, mutations queued with client UUIDs, explicit sync state UI. SQLite-class
durability and background sync require the native app — next step after pilot, per
Blueprint §10's own escalation path.

## ADR-009 — Background processing: transactional outbox first, BullMQ when Redis exists

**Status:** Accepted (mirrors Tech Spec §14.2, adapted for environment)
**Decision:** Business writes append `outbox_events` rows inside the same transaction.
A dedicated worker process polls unpublished rows and executes handlers
(notifications, PM generation, report rendering, renewal tasks) idempotently, marking
`published_at`/`attempts`/`last_error`. Redis is unavailable in the sandbox; BullMQ is
the intended production fan-out/priority layer and will be added behind the same
outbox contract when Redis is provisioned. The outbox remains the durable source of
intent (spec §23.1: Redis is never the only copy of business-critical data).

## ADR-010 — File storage: StoragePort with local-disk dev adapter, S3 in production

**Status:** Accepted (mirrors Tech Spec §13, §17)
**Decision:** `StoragePort` interface (`put`, `getStream`, `signedUrl`, `delete`).
Local development: private on-disk storage under `data/uploads/` with opaque
tenant-namespaced object keys, SHA-256 checksums, MIME sniffing from file bytes, size
caps, and short-lived **signed download tokens** issued only after authorization
(equivalent semantics to S3 presigned URLs). Production adapter: S3 private bucket +
KMS + presigned URLs (implemented behind the same port, activated by env, requires AWS
credentials not present in this environment). Upload-intent flow follows Tech Spec §13.2.

## ADR-011 — Email/WhatsApp are clearly-labelled development no-ops

**Status:** Accepted (user rule §14 — never pretend an integration sent something)
**Decision:** In-app notifications are fully implemented (real DB records, read state,
notification centre). Email and WhatsApp adapters exist behind a `NotificationChannel`
port but, without provider credentials, record `delivery_status =
'skipped_dev_no_provider'` and log a clearly-labelled skip line. No message is ever
reported as sent when it was not. Enabling SES/WhatsApp Business requires only env
credentials + adapter activation.

## ADR-012 — Customer portal and native mobile app are out of MVP scope

**Status:** Accepted (Blueprint §7 marks portal P1; Tech Spec §30.2 leaves app
distribution undecided)
**Decision:** The RBAC model reserves the `customer_portal` role and the API design
keeps portal-safe separation of internal vs customer-visible notes, but no portal UI
ships in this release. Focus stays on the OEM internal workflow (all three documents
agree the wedge is the internal after-sales lifecycle).

## ADR-013 — Documents' illustrative data is not business fact

**Status:** Accepted (all three documents' own caveat sections)
**Decision:** Proposed prices (₹7,500–₹80,000/month), company shortlists and public
contact details in the Customer Validation Kit are *research inputs*, not confirmed
leads or pricing. Seed data uses **fictional** companies and people only (data-hygiene
rule, Validation Kit §07). No real prospect name, email or phone enters the codebase.
SLA targets and KPI thresholds are treated as internal engineering objectives, not
contractual commitments (Tech Spec §19).

## ADR-014 — API conventions follow the Technical Specification

**Status:** Accepted (minor Blueprint/Tech-Spec endpoint naming conflict)
**Conflict:** Blueprint §14 shows `/service-requests/{id}/convert-to-work-order`;
Tech Spec §10.2 shows `/service-requests/{id}/convert`.
**Resolution:** the Tech Spec wins for API shape (hierarchy §2): `POST /api/v1/service-requests/{id}/convert`.
Response/error envelopes, cursor pagination, idempotency keys and `expectedVersion`
optimistic concurrency follow Tech Spec §10.1 exactly.

## ADR-015 — Seed and demo data

**Status:** Accepted
**Decision:** Deterministic seed (`prisma/seed.ts`) creates two isolated demo tenants
with distinct users ("GridNova Systems Pvt. Ltd." and "Voltline Power Systems" —
fictional) plus customers, sites, LT/HT panel assets, a warranty + AMC contract, a
service request → work order flow, checklist templates and PM plans, so that every
screen and metric renders with realistic data and cross-tenant isolation can be
demonstrated. Demo credentials are documented in DEVELOPMENT_SETUP.md and are
dev-environment only.

## ADR-016 — Numbering: tenant-scoped human-readable sequences

**Status:** Accepted (Blueprint §12, Tech Spec §24.3)
**Decision:** `number_sequences` table per tenant + key (e.g. `service_request`, year).
Format: `SR-2026-000123`, `WO-2026-000045`, `CTR-2026-000007`, `AST-000123`. Allocation
happens inside the creation transaction (`SELECT … FOR UPDATE`), which keeps numbers
gap-free-per-tenant under concurrency without global database sequences.

## ADR-017 — Work-order state machine (explicit transition table)

**Status:** Accepted (Tech Spec §12.2 diagram is "indicative"; exact table defined here)
**Decision:** States: `draft → ready → scheduled → in_progress → on_hold →
pending_review → completed → closed`, plus `cancelled` reachable from open states.
Guards: transition permission + reason required for cancellation/reopen; cannot reach
`pending_review` until execution evidence submitted; cannot reach `closed` until
mandatory checklist items complete + service report approved; closed work orders are
never edited — corrections create a superseding report version (Tech Spec §12.3).
Every transition appends `work_order_events` + audit + outbox rows in one transaction.

## ADR-018 — Checklists are versioned and immutable at assignment

**Status:** Accepted (Tech Spec §11.2, §12.3)
**Decision:** `checklist_templates` hold an `active_version`; each version's definition
(JSONB, validated against a versioned schema) is immutable once approved. A work order
snapshots the exact `template_version_id`; results reference it. Required items block
`pending_review`/closure unless an authorized exception with reason is recorded.

## ADR-019 — Analytics are computed from real data only

**Status:** Accepted (user rule §13 — no fake dashboard metrics)
**Decision:** Every dashboard figure is a SQL aggregate over live tables (open requests,
overdue work orders, technician workload, PM completion, SLA attainment, renewal
pipeline, asset completeness). No hardcoded numbers anywhere in frontend or backend.

## ADR-020 — Timezone, currency and i18n foundations

**Status:** Accepted (Tech Spec §26)
**Decision:** All timestamps stored `timestamptz` UTC; tenants and sites carry IANA
timezone names (`Asia/Kolkata` default); money is `bigint` minor units + ISO-4217
currency code; addresses are structured JSONB with explicit country field (never
India-only assumptions). UI starts in English with translation-ready message
concentration (no per-screen hardcoded copy duplication at scale).

## ADR-021 — Web console is a single-route SPA with a hash router

**Status:** Accepted (deviation from ARCHITECTURE §5 draft, driven by sandbox constraint)
**Decision:** The deployment sandbox exposes exactly one user-visible URL to the user
(the Next.js `/` route; the platform explicitly forbids other routes). The console is
therefore an SPA mounted at `/`, loaded via `next/dynamic` with `ssr: false`
(session state is client-only), with an internal hash router
(`src/lib/router.ts`) providing deep-linkable views (`#/work-orders/<id>`),
back/forward support and filter-preserving navigation. Production keeps the same
bundle; migrating to App Router route groups later is a mechanical change.
**Related learnings (all fixed and covered by tests/verification):**
- Login/refresh responses omit membership permission arrays (only `GET /auth/me`
  carries them — they derive from the role catalog); the client hydrates them right
  after a session is applied.
- Zustand v5 selectors must return reference-stable values (fresh `[]`/`{}`
  fallbacks caused `useSyncExternalStore` re-render loops → "Maximum update depth").
- Radix `Select.Item` forbids empty-string values; the shared `EnumSelect` maps
  "all/none" options to an internal sentinel.

## ADR-022 — API process supervision in the sandbox

**Status:** Accepted (environment adaptation)
**Decision:** Shell-started background processes are reaped when an agent session
ends, while platform-managed processes persist. The web console's Next.js
`instrumentation` hook (`src/instrumentation*.ts`) therefore performs an idempotent
health check on boot and spawns the API + worker (detached) when `:4000` is not
answering; `scripts/spawn-daemon.py` provides the same double-fork daemonization
(the proven `pg_ctl` pattern) for manual starts, and `scripts/api-up.sh` wraps it
idempotently. On platform reboots `.zscripts/dev.sh` starts the services first, so
the hook finds them healthy and spawns nothing.

## ADR-023 — Numbering sequence keys must match the code format

**Status:** Accepted (bug fix with regression relevance)
**Defect:** Yearly documents key their sequence as `<kind>:<year>` (e.g.
`service_request:2026`) while flat sequences (customer, asset) use the bare key.
The seed created flat keys but the allocator always appended the year, so the first
customer/asset creation on a seeded tenant started a *new* sequence at 1 and
collided with existing codes (`409 DUPLICATE`).
**Resolution:** `NumberingService.next` now derives the sequence key from the same
yearly/flat decision that formats the code. Documented in
DEVELOPMENT_SETUP.md troubleshooting; fresh tenants were never affected, which is
why the integration suite (fresh tenants) did not catch it.

## ADR-024 — Refresh-cookie parsing is an explicit middleware dependency

**Status:** Accepted (bug fix)
**Defect:** Express does not populate `req.cookies` without `cookie-parser`; the
rotating refresh-token flow silently degraded to `{accessToken: null}` on every
reload (Set-Cookie worked, requests never carried the cookie).
**Resolution:** `app.use(cookieParser())` registered in `main.ts` (test apps spawn
the same entrypoint, so the integration suite covers it). Symptom recorded in
DEVELOPMENT_SETUP.md: "login works but session lost on reload".

---

## Conflicts and requirements not specified adequately (tracked)

| # | Gap / open question | Current handling | Owner note |
| - | ------------------- | ---------------- | ---------- |
| 1 | Exact per-role transition permissions for work orders | Defined in `ROLE_PERMISSIONS` (contracts) + transition table; flagged for customer validation | Needs service-manager interview |
| 2 | SLA default targets per priority | Tenant settings defaults (P1: 4h/48h …) snapshot onto work orders; configurable | Validate with pilots |
| 3 | Checklist definition schema v1 | JSONB schema documented in docs/API.md; LT panel + HT switchgear templates seeded | Confirm with real SOPs |
| 4 | Technician skills/availability model | Skills tags on membership; no availability engine (P0-basic per Blueprint §7) | Later phase |
| 5 | Offline conflict UX for PWA | Conflict queue UI + server `conflict` results; full native handling deferred (ADR-008) | — |
| 6 | Data retention defaults | `deleted_at` soft-delete on mutable masters; retention policy config deferred | Legal review (DPDP) |
| 7 | Email-to-ticket intake | Manual + portal-safe API only (Tech Spec §30.2 decision #4 = defer) | — |
| 8 | Mobile app distribution | Undecided in spec; PWA now (ADR-008) | Post-pilot |

---

## ADR-025 — Engineering audit remediation: security and data-integrity hardening (2026-11-01)

**Context:** An engineering audit identified risks across offline data isolation,
rate limiting, DB roles, file authorization/scanning, sync idempotency, AMC
expiry, outbox claiming, PWA foundations and production infrastructure.

**Decisions (all implemented and tested — see docs/REMEDIATION_REPORT.md):**

1. **Offline stores are user+tenant scoped and purged on session end (SEC-01).**
   All technician PWA caches/queues live under
   `serviceos.v2.<kind>.<userId>.<tenantId>` (legacy unscoped keys are purged);
   logout and workspace switching call `clearOfflineData()`. Workspace switch
   confirms before discarding unsynced captures.
2. **Rate limiting via ThrottlerModule + `ServiceThrottlerGuard` (SEC-02).**
   Guard order: authentication → throttling → permissions, so trackers key on
   user id (authenticated) or real client IP (`TRUST_PROXY`). Global window
   env-driven; auth/upload/sync routes carry @Throttle overrides.
   `RATE_LIMITING=off` is a documented test seam used by the shared suite only.
3. **A third, least-privilege database role for the worker (SEC-03).**
   `serviceos_worker` (migration 20261101154951 + 20261101162000) may only
   claim/update outbox events, read maintenance plans and contracts, and update
   its heartbeat — enforced by table grants AND role-targeted RLS policies.
4. **Object-level file authorization + fail-closed malware scanning (SEC-04/06).**
   Technicians can read only own uploads or files on their actively assigned
   work orders; uploads are scanned (EICAR/executable signature scanner default,
   ClamAV INSTREAM adapter in production) BEFORE persistence; scanner failures
   reject the upload.
5. **Atomic mobile-sync idempotency (DATA-02).** The
   `mobile_sync_operations` row is INSERTED FIRST as a claim — the unique
   (tenant_id, operation_id) index serializes concurrent duplicates, so an
   operation applies exactly once; the claim is finalized with the outcome.
   A crash between apply and finalize surfaces an honest `pending` result for
   user reconciliation.
6. **Outbox claiming with FOR UPDATE SKIP LOCKED + lease (DATA-06).** Multiple
   worker instances can never double-process an event; a crashed worker's lease
   expires and the row becomes claimable again. PM/renewal passes are
   time-gated on the heartbeat row (single pass per window cluster-wide).
7. **AMC expiry on UTC-day boundaries with deduplicated reminders (DATA-04/05).**
   A contract is covered through the END of its end date; the renewal pass has
   no lower time bound (worker downtime never misses an expiry); reminders use
   `dedup_key` unique per (tenant, user, contract, horizon).
8. **Bounded, incremental job packs (DATA-07).** `limit` (server-capped 200) +
   `since` cursor on `work_orders.updated_at`; child captures touch the
   aggregate so peers receive deltas.
9. **PWA: manifest + hand-written service worker (PWA-01..07).** No next-pwa
   dependency: network-first navigations with /offline fallback, cache-first
   only for `cache-control: immutable` assets (dev-safe), network-first cache
   for mobile GET data, never mutations; Background Sync wakes the durable
   localStorage queue.
10. **Production storage contract (SEC-07/INFRA-01).** `loadEnv()` refuses
    `STORAGE_DRIVER=local` in production; the S3 adapter (AWS SDK v3, presigned
    GET, SSE-KMS optional) is activated by env through the StorageModule
    factory. Findings recorded as new known-gaps: ClamAV/S3 live runs need
    external services (credentials/sidecars documented).

**Consequence:** the `20261101165000` migration also fixes a latent multi-tenant
bug the new tests exposed — `request_no`/`work_order_no` were per-tenant
sequences behind GLOBAL unique indexes (two tenants collided on their first
request); both are composite `(tenant_id, …)` uniques now, matching every other
document number.
