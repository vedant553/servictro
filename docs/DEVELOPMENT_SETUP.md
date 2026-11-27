# ServiceOS — Development Setup

## 1. Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Bun | ≥ 1.3 | Workspace runtime & package manager |
| Node.js | ≥ 22 (24 tested) | Runs the compiled NestJS API/worker |
| PostgreSQL | 17 | **Provided embedded** — no system install needed |

Docker is **not** required locally: `@embedded-postgres/linux-x64` ships real
PostgreSQL 17 binaries managed by `scripts/pg.sh` (initdb → pg_ctl, port **5433**,
data under `.pgdata/`).

## 2. First boot

```bash
bun install                                  # workspace deps (root + packages + mini-services)
bash scripts/pg.sh start                     # embedded PostgreSQL on 127.0.0.1:5433
cd mini-services/serviceos-api
cp .env.example .env                         # then fill the two JWT secrets:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
bun run dev                                  # prisma generate → migrate deploy →
                                             # seed (first boot only) → API :4000 + worker
```

In a second shell (project root):

```bash
bun run dev                                  # Next.js console on :3000 (platform-managed
                                             # in the sandbox; instrumentation ensures the
                                             # API/worker are up)
```

Browse to the preview / `http://localhost:81`. Swagger: `http://localhost:4000/api/docs`.

## 3. Demo credentials (seeded, fictional — ADR-015)

| Tenant | Email | Password |
| --- | --- | --- |
| GridNova Systems Pvt. Ltd. | `owner@gridnova.example` | `DemoOwner#2026` |
| GridNova Systems Pvt. Ltd. | `coord@gridnova.example` | `DemoCoord#2026` |
| GridNova Systems Pvt. Ltd. | `tech@gridnova.example` | `DemoTech#2026` |
| GridNova Systems Pvt. Ltd. | `manager@gridnova.example` | `DemoOwner#2026` |
| Voltline Power Systems | `owner@voltline.example` | `DemoOwner#2026` |

Two isolated tenants exist so cross-tenant behaviour is demonstrable. Re-seed any time:

```bash
bash scripts/pg.sh reset && bash scripts/pg.sh start
cd mini-services/serviceos-api && bunx prisma migrate deploy && bunx tsx prisma/seed.ts
```

## 4. Everyday commands

| Command | Purpose |
| --- | --- |
| `bash scripts/pg.sh start\|stop\|status\|reset` | Embedded PostgreSQL lifecycle (+ worker-role LOGIN provisioning) |
| `bash scripts/api-up.sh` | Idempotent API+worker start (health-checked) |
| `cd mini-services/serviceos-api && bun run dev` | Full backend dev loop (watch build) |
| `cd mini-services/serviceos-api && bun run test` | 111-test suite (unit + API integration over real PostgreSQL) |
| `cd mini-services/serviceos-api && bun run test:unit` | Unit tests only |
| `bun test src/lib/offline-store.test.ts` | Frontend offline-queue unit tests |
| `cd mini-services/serviceos-api && bun run db:migrate:dev` | Create/apply a migration |
| `cd mini-services/serviceos-api && bun run db:studio` | Prisma Studio |
| `bun run lint` / `bun run typecheck` | Web console quality gates |
| `docker compose -f docker-compose.dev.yml up --build` | Full stack via Docker (Postgres, migrate, api, worker, web) |
| `bash scripts/backup-db.sh` / `restore-db.sh` | Logical backup + restore drill (needs pg_dump/pg_restore on PATH) |
| `python3 scripts/spawn-daemon.py bash -c "<cmd>" --log <file>` | Survivable background process (double-fork) |

## 5. Gateway routing (sandbox)

One external port; the Caddy gateway (`:81`) selects the backend by query parameter:

- Web console — plain paths → `:3000`
- API calls — **append `?XTransformPort=4000`** (the typed API client does this
  automatically; signed download URLs already include it)

All frontend fetches use **relative paths only**.

## 6. Environment variables (API)

See `.env.example`. Beyond the obvious (`PORT`, `DATABASE_URL`, `JWT_*`):

| Var | Meaning |
| --- | --- |
| `DATABASE_MIGRATE_URL` | Owner-role URL used by `prisma migrate` (RLS bypass) |
| `DATABASE_WORKER_URL` | **Least-privilege worker role** (audit SEC-03): claim outbox events, read plans/contracts, heartbeat only |
| `STORAGE_DRIVER` / `STORAGE_LOCAL_DIR` / `MAX_UPLOAD_MB` | File storage port (ADR-010). `local` is refused in production |
| `STORAGE_S3_*` | S3 driver settings (bucket, region, endpoint, path style, KMS key) |
| `MALWARE_SCANNER` | `signature` (default) / `clamav` (`CLAMD_HOST`/`CLAMD_PORT`) / `disabled` (dev-only; refused in production) |
| `RATE_LIMITING` / `THROTTLE_LIMIT` / `THROTTLE_TTL_MS` / `AUTH_THROTTLE_LIMIT` | Rate limiting (SEC-02); `RATE_LIMITING=off` is a test seam |
| `TRUST_PROXY` | Express trust-proxy setting for real client IPs (default `loopback`) |
| `WORKER_POLL_MS` | Outbox poll interval; `/health/worker` reports healthy within 3× this |
| `API_PUBLIC_URL` / `API_GATEWAY_PORT` | Signed URL base; `XTransformPort` suffix injection |
| `ENABLE_SWAGGER` | `/api/docs` (dev default on) |

Tests read `TEST_PG_HOST` / `TEST_PG_PORT` (default `127.0.0.1:5433`) so CI
can point the same suite at a service container.

**NODE_ENV matters**: in `development` the project `.env` overrides inherited shell
variables (the sandbox shell leaks an unrelated `DATABASE_URL`); in `test`/production
real environment variables win. This is why the daemons in this repo start the API with
`NODE_ENV=development`.

## 7. Troubleshooting

| Symptom | Cause & fix |
| --- | --- |
| API dead after shell session ends | Start via `scripts/api-up.sh` or the double-fork daemonizer; the Next.js `instrumentation` hook also self-heals it on server boot |
| `P1012 … URL must start with postgresql://` | A leaked `DATABASE_URL` (SQLite) won — start with `NODE_ENV=development` so `.env` overrides |
| Login works but session lost on reload | Refresh cookie not parsed — `cookie-parser` must be registered (fixed in `main.ts`) |
| `409 DUPLICATE` creating first customer/asset on a seeded tenant | Numbering sequence key mismatch (fixed — flat keys `customer`/`asset`, yearly `*:2026`) |
| 429 on repeated logins in tests | Login throttle is 10/min per IP — wait out the window between suite runs |
| Radix `Select.Item must have a value prop that is not an empty string` | Never pass `value: ""` options directly — the shared `EnumSelect` maps them to a sentinel |
