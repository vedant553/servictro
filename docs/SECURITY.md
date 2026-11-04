# ServiceOS — Security

Threat model: multi-tenant B2B SaaS holding customer installed-base data, service
history and contract terms. Trust boundaries: browser ↔ gateway ↔ API ↔ DB/storage.

## 1. Authentication & session (ADR-006)

- **Passwords**: bcrypt, cost 12, minimum length + composition enforced by DTO.
- **Access tokens**: HS256 JWT, 15-minute TTL, tenant claim embedded. The web console
  keeps them **in memory only** (never localStorage).
- **Refresh tokens**: opaque 256-bit secrets, stored **hashed** (SHA-256) server-side,
  delivered as an `httpOnly; SameSite=Lax; Path=/api/v1/auth` cookie, rotated on every
  use. **Reuse detection**: replaying a rotated token revokes the whole session family.
- **Local credentials are an adapter**: `users.identity_issuer/identity_subject` and the
  AuthService port keep a managed OIDC provider (Auth0/WorkOS/Cognito) swappable
  without domain changes. MFA and password-reset email require that provider (not
  available in the sandbox — documented limitation).

## 2. Tenant isolation (ADR-005) — three layers

1. **Application**: every repository call runs inside a tenant-scoped interactive
   transaction that first executes `SELECT set_config('app.tenant_id', <uuid>, true)`.
   The tenant id comes from the JWT + membership lookup — never from client input.
   `X-Tenant-Id` is a validated hint only.
2. **Database**: `FORCE ROW LEVEL SECURITY` on every tenant-owned table; policies
   `USING/WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid)`. The API
   connects as the non-owner role `serviceos_app`; migrations run as the owner role.
   Transaction-local settings prevent pooled-session leakage (spec §15.3 warning).
3. **Relational**: composite foreign keys `(tenant_id, child_id) → (tenant_id, id)`
   reject cross-tenant references at write time.

Negative tests in `test/api/workflow.spec.ts`: cross-tenant read/mutate/reference-chain
attempts and forged `X-Tenant-Id` headers all return 403/404.

## 3. Authorization (RBAC)

Catalogue in `packages/contracts/permissions.ts` (`ROLE_PERMISSIONS`); routes declare
`@RequirePermissions(...)`. Default deny; UI hiding is cosmetic — the API decides.
Technicians additionally can only view/execute **assigned** work orders (`NOT_ASSIGNED`
403 otherwise).

## 4. Input validation & injection

- class-validator DTOs, `whitelist + forbidNonWhitelisted` — unknown fields rejected.
- Prisma parameterized queries everywhere; the two raw statements (numbering upsert,
   tenant `set_config`) use tagged templates / bound parameters.
- `helmet` (CSP disabled only when Swagger is enabled in dev), 1 MB JSON body cap.
- React renders as text — no `dangerouslySetInnerHTML` except the generated QR SVG
  (server-generated, constant shape).

## 5. Files (ADR-010, audit remediation SEC-04/06/07)

Upload intent → size cap (MAX_UPLOAD_MB, default 25) → **MIME sniffed from magic
bytes** (extension never trusted) → **malware scan before persistence** →
SHA-256 checksum → opaque tenant-namespaced object key. Downloads require
authorization and are issued as **short-lived HMAC-signed URLs** (S3-presigned
semantics); responses set `Content-Disposition: attachment` with a sanitized ASCII
filename and `Cache-Control: private, no-store` + `X-Content-Type-Options: nosniff`.

**Malware scanning (SEC-06)** — every upload is scanned BEFORE any bytes are
persisted; verdicts: `clean` (accepted, `scan_status=clean`), `infected`
(`FILE_INFECTED` 422 + audit `file.rejected_malware`), or scanner `failed`
(`SCAN_UNAVAILABLE` 503 — **fail-closed**, never "accept unscanned"). Modes:
- `MALWARE_SCANNER=signature` (default) — built-in EICAR + executable-format
  (PE/ELF/Mach-O) + shebang detection. Baseline defence, no daemon needed.
- `MALWARE_SCANNER=clamav` — full ClamAV engine over the INSTREAM protocol
  (`CLAMD_HOST`/`CLAMD_PORT`, sidecar in docker-compose.prod.yml / ECS).
- `disabled` is rejected at boot in production.
Signed downloads additionally require `scan_status=clean`.

**Object-level authorization (SEC-04)** — `files:read` alone never grants a
specific attachment; the technician role is bounded to its own uploads and
files attached to work orders (or their reports) the technician is actively
assigned to. Every denial is audited (`file.download_denied`).

**Production storage guard (SEC-07)** — `loadEnv()` refuses to boot with
`STORAGE_DRIVER=local` when `NODE_ENV=production` (fail-fast, never a runtime
surprise), and requires bucket/region when the S3 driver is selected.

## 6. Rate limiting & abuse (audit remediation SEC-02)

`@nestjs/throttler` is ACTIVE (module + `ServiceThrottlerGuard` wired in the
global guard chain after authentication):
- global window: `THROTTLE_LIMIT` per `THROTTLE_TTL_MS` (default 300/min);
- auth endpoints: login/register 10/min, refresh 30/min per client IP;
- file upload: 30/min; mobile sync push: 120/min.

Authenticated requests are throttled **per user id** (fair across tenants
sharing an office NAT); anonymous endpoints per IP. The express app runs with
`TRUST_PROXY` (default `loopback`) so `req.ip` is the real client address
behind the gateway/ALB. Responses use the standard envelope with code
`RATE_LIMITED` and 429. `RATE_LIMITING=off` is a documented test seam only.

## 7. Audit & traceability

Every privileged mutation appends an `audit_events` row in the same transaction:
actor, action, resource, reason, requestId, IP hash. Request ids flow through
structured pino logs (`requestId`/`tenantId`/`userId`) for end-to-end correlation.
File security adds: `file.rejected_malware`, `file.scan_unavailable`,
`file.download_denied` (object-level denials). 

## 8. Secrets & configuration

- Secrets via environment only (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
  database URLs); `.env` files are dev-only and **not tracked by git** — the
  remediation removed the previously-committed `.env` from the index and added
  a root `.env.example` (SEC-05).
- **Database roles (SEC-03, INFRA-08)** — three LOGIN roles, least privilege:

| Role | Used by | Can do | Cannot do |
| --- | --- | --- | --- |
| `serviceos_migrate` | CI/CD `prisma migrate` only | DDL, owns schema | serve requests |
| `serviceos_app` | API process | DML on all tables **through RLS** tenant checks | DDL, cross-tenant reads |
| `serviceos_worker` | background worker | claim/update outbox events, read plans/contracts, update heartbeat | read customer/user data, INSERT/DELETE anything, DDL |

  The worker role's grants + role-targeted RLS policies live in migration
  `20261101154951`; provisioning LOGIN credentials is `scripts/db-bootstrap-roles.sql`
  (production: passwords from Secrets Manager, see DEPLOYMENT.md §2).
- Offline caches (technician PWA) are **scoped per user+tenant** in
  `localStorage` and purged on logout/workspace switch (SEC-01) — see
  `src/lib/offline-store.ts`.

## 9. Known gaps (tracked)

| Gap | Status |
| --- | --- |
| MFA / password-reset email | Requires managed IdP (ADR-006) |
| Email/WhatsApp delivery | No provider credentials — clearly-labelled skip (ADR-011) |
| ClamAV engine live-verified | Adapter implemented + INSTREAM framing; requires a clamd sidecar to exercise end-to-end (not present in sandbox) |
| S3 adapter live-verified | Implemented + config-validated; requires AWS credentials (integration-tested path is local driver) |
| Field-level encryption for PII contacts | Deferred — DPDP review pending (gap #6) |
