#!/usr/bin/env bash
# ServiceOS API — dev runner: PostgreSQL (idempotent) → prisma generate →
# migrations → first-boot seed → tsc watch build + node --watch for API
# (:4000) and worker.
#
# NOTE: tsx is intentionally NOT used for the NestJS processes — it does not
# emit design:paramtypes decorator metadata in this environment, which breaks
# NestJS dependency injection. The compiled build is also closer to the
# production runtime (dist/ is what Docker ships).
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

set -a
[ -f .env ] && . ./.env
set +a

PG_PORT="${PG_PORT:-5433}"

bash ../../scripts/pg.sh start

echo "[serviceos-api] Generating Prisma client..."
bunx prisma generate

echo "[serviceos-api] Applying migrations..."
bunx prisma migrate deploy
echo "[serviceos-api] Migrations applied."
# Re-run the (idempotent) cluster provisioning: the least-privilege
# serviceos_worker role is created NOLOGIN by migration 20261101154951, so
# its dev LOGIN can only be enabled after migrations have run.
bash ../../scripts/pg.sh start

# Seed only when the tenants table is empty (first boot after a reset).
SEEDED=$(bunx tsx -e "
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const c = await p.tenant.count();
console.log(c > 0 ? 'yes' : 'no');
await p.\$disconnect();
" 2>/dev/null || echo "no")
if [ "$SEEDED" != "yes" ]; then
  echo "[serviceos-api] Seeding demo data..."
  bunx tsx prisma/seed.ts || echo "[serviceos-api] Seed skipped/failed (non-fatal)"
fi

echo "[serviceos-api] Building TypeScript..."
bunx tsc -p tsconfig.build.json
if [ ! -f dist/main.js ]; then
  echo "[serviceos-api] FATAL: build produced no dist/main.js"
  exit 1
fi

cleanup() {
  [ -n "${TSC_PID:-}" ] && kill "$TSC_PID" 2>/dev/null
  [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null
  [ -n "${WORKER_PID:-}" ] && kill "$WORKER_PID" 2>/dev/null
}
trap cleanup EXIT INT TERM

echo "[serviceos-api] Watching TypeScript..."
bunx tsc -p tsconfig.build.json --watch --preserveWatchOutput --sourceMap &
TSC_PID=$!

echo "[serviceos-api] Starting API (port ${PORT:-4000})..."
node --watch --enable-source-maps dist/main.js &
API_PID=$!

echo "[serviceos-api] Starting worker..."
node --watch --enable-source-maps dist/worker.js &
WORKER_PID=$!

echo "[serviceos-api] tsc PID=$TSC_PID, API PID=$API_PID, worker PID=$WORKER_PID"
wait
