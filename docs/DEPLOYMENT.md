# ServiceOS — Deployment

## 1. Production target (Tech Spec §20)

```
Route53 → CloudFront → ALB (+ AWS WAF)
                       ├─ ECS Fargate service: web   (Next.js standalone)
                       ├─ ECS Fargate service: api   (NestJS REST)
                       └─ ECS Fargate service: worker (same image, worker entrypoint)
RDS PostgreSQL 17 Multi-AZ  ──  ElastiCache (Valkey)  ──  S3 private bucket (+KMS)
EFS/FSx for uploaded artifacts? → S3 only (presigned URLs)
Terraform (ap-south-1) + GitHub Actions OIDC per environment
```

The API and worker are **two entrypoints of the same codebase**
(`dist/main.js`, `dist/worker.js`) — separate task definitions, one image.

All of this topology now exists as runnable artifacts (audit INFRA-01..08):

| Layer | Artifact |
| --- | --- |
| API/worker image | `mini-services/serviceos-api/Dockerfile` (multi-stage, non-root, tini, HEALTHCHECK) |
| Web image | `Dockerfile.web` (Next.js standalone) |
| Single-host stack | `docker-compose.prod.yml` (Caddy TLS, ClamAV sidecar, S3 storage) |
| Local dev stack | `docker-compose.dev.yml` (Postgres 17 + roles bootstrap + migrate job) |
| Cloud infra | `infra/terraform/` (VPC, RDS, S3+KMS, Secrets Manager, IAM, ECS, ALB, alarms) |
| CI | `.github/workflows/ci.yml` (typecheck, unit, integration over real Postgres, builds; deploy job template) |
| Backups | `scripts/backup-db.sh`, `scripts/restore-db.sh` + RDS automated backups/PITR in Terraform |
| Role bootstrap | `scripts/db-bootstrap-roles.sql` |

## 2. Environment matrix

| Variable | Web | API | Worker | Notes |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | — | ✓ | ✓ | RDS via Secrets Manager; role `serviceos_app` (RLS applies) |
| `DATABASE_MIGRATE_URL` | — | ✓ (migrate job) | — | Owner role, used only by `prisma migrate deploy` in a release job |
| `DATABASE_WORKER_URL` | — | ✓ | ✓ | **Least-privilege worker role** (SEC-03): claim/update outbox, read plans/contracts, heartbeat |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | — | ✓ | ✓ | Secrets Manager; rotate by rolling refresh family |
| `APP_URL` / `CORS_ORIGINS` | ✓ | ✓ | — | Exact origins; credentials allowed |
| `STORAGE_DRIVER=s3` + bucket/region/KMS | — | ✓ | ✓ | Activates the S3 adapter behind `StoragePort` (ADR-010). **`local` refuses to boot in production (SEC-07)** |
| `MALWARE_SCANNER` | — | ✓ | ✓ | `signature` (built-in) or `clamav` (`CLAMD_HOST/PORT`); `disabled` refuses to boot in production |
| `RATE_LIMITING`, `THROTTLE_LIMIT`, `THROTTLE_TTL_MS`, `AUTH_THROTTLE_LIMIT` | — | ✓ | — | Rate limiting (SEC-02) |
| `TRUST_PROXY` | — | ✓ | — | Express trust-proxy setting for correct client IPs (default `loopback`) |
| `REDIS_URL` | — | ✓ | ✓ | Enables BullMQ fan-out on top of the outbox (ADR-009) |
| `API_PUBLIC_URL` | — | ✓ | — | Clean absolute URL — **no `XTransformPort`** in production |
| `WORKER_POLL_MS` | — | — | ✓ | Outbox poll cadence (heartbeat monitoring uses 3× this) |
| `NODE_ENV=production` | ✓ | ✓ | ✓ | Env vars take precedence over any file |

**Credential separation (INFRA-08)**: each role's URL is its own Secrets
Manager secret (`serviceos/<env>/db/{migrate,app,worker}-url`) — rotatable
independently; the migrate secret is only readable by the CI release job.
First-run bootstrap: `psql "$MASTER_URL" -f scripts/db-bootstrap-roles.sql`.

## 3. Release checklist

1. **Migrations**: CI release job runs `prisma migrate deploy` as the migrate
   role *before* new tasks go healthy (migrations are forward-only and
   immutable). Template in `.github/workflows/ci.yml` (deploy job).
2. **Build**: multi-stage Dockerfiles (Node 22-slim runtime, non-root user,
   `dist/` + production `node_modules`, tini signal handling, HEALTHCHECK).
3. **Web**: `next build` (standalone output already configured).
4. **Smoke**: `/health/ready` (DB + storage) on each service; `/health/worker`
   (background pipeline heartbeat) before shifting traffic.
5. **Observability**: structured pino JSON → CloudWatch (log groups in
   `infra/terraform/ecs.tf`); alarms for ALB 5xx, RDS CPU/storage/connections,
   worker stall (ECS RunningTaskCount + Synthetics canary on `/health/worker`).
6. **Backups**: RDS automated snapshots + PITR (Terraform
   `db_backup_retention_days`, default 14) + nightly logical dumps
   (`scripts/backup-db.sh` → S3, SSE, verified, retention-pruned); restore
   drill with `scripts/restore-db.sh` (dry-run by default).

## 4. Hardening before GA

- [ ] Managed OIDC provider wired into the AuthService port (ADR-006) — MFA, password reset.
- [ ] SES email + WhatsApp Business adapters activated behind the NotificationChannel
      port (today they record `skipped_dev_no_provider`, never fake sends — ADR-011).
- [x] AV scanning hook for uploads — implemented (SEC-06): signature scanner
      default, ClamAV INSTREAM adapter for production.
- [x] Route-level rate limits beyond auth — implemented (SEC-02); WAF rules on
      the ALB remain a task.
- [ ] Pen-test the tenant-isolation suite against staging with two real tenants.
- [ ] DPDP/retention review: soft-delete purge jobs (gap #6).
- [ ] Terraform live apply (module written; needs an AWS account + ACM DNS
      validation) — see §6.

## 5. Sandbox ↔ production differences (already handled)

| Concern | Sandbox | Production |
| --- | --- | --- |
| Gateway | Caddy `:81` + `?XTransformPort=4000` | ALB path/host routing — clean URLs |
| Process supervision | Next.js `instrumentation` self-heal + double-fork daemons | ECS task definitions + restart policies |
| PostgreSQL | Embedded binaries on :5433 | RDS Multi-AZ |
| Files | Local private dir + HMAC signed URLs | S3 + KMS + presigned URLs (same port) |
| Background jobs | Outbox polling worker (least-privilege role) | Outbox + BullMQ on ElastiCache (same contract) |
| Secrets | `.env` (dev-only, **untracked**) | Secrets Manager / SSM |
| Malware scanning | Signature scanner | ClamAV sidecar (compose) / ECS sidecar |
| Rate limiting | On (dev defaults) | On (env-tuned, per-user tracking) |

## 6. Bringing the Terraform stack up (first time)

```bash
cd infra/terraform
# 1. Remote state (S3 + DynamoDB lock) — create once per account:
terraform init -backend-config=bucket=serviceos-tfstate-<account> \
               -backend-config=dynamodb_table=serviceos-tfstate-locks \
               -backend-config=region=ap-south-1

# 2. Plan with real image tags (built+pushed by CI) and your domains:
terraform plan -var='api_image=<ecr>/serviceos/api:sha-<git>' \
               -var='web_image=<ecr>/serviceos/web:sha-<git>' \
               -var='app_domain=serviceos.example.com' \
               -var='api_domain=api.serviceos.example.com'

# 3. Apply, then bootstrap roles once against the RDS master password from
#    Secrets Manager (serviceos/<env>/db/master):
terraform apply ...
psql "$(aws secretsmanager get-secret-value ... master --query SecretString --output text)" \
     -h <rds-endpoint> -f ../../scripts/db-bootstrap-roles.sql

# 4. First migration (migrate role only):
DATABASE_MIGRATE_URL="$(aws secretsmanager ... migrate-url ...)" \
  bunx prisma migrate deploy
```

ACM DNS validation records appear in `terraform output` (create them in
Route53, then re-apply). Point `app_domain`/`api_domain` CNAMEs at the
`alb_dns_name` output.
