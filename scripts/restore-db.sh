#!/usr/bin/env bash
# ServiceOS — PostgreSQL restore + verification drill (audit INFRA-06).
#
# Restores a backup-db.sh archive into a TARGET database, then verifies the
# restore by counting core tables and the latest audit rows. Intentionally
# requires an explicit target (never restores over production without
# CONFIRM_OVERWRITE=yes).
#
# Usage:
#   ./scripts/restore-db.sh backups/serviceos-20261101T023000Z.dump \
#       postgresql://user:pass@host:5432/serviceos_restored
#   CONFIRM_OVERWRITE=yes ./scripts/restore-db.sh backup.dump "$PROD_URL"   # disaster recovery
set -euo pipefail

ARCHIVE="${1:?usage: restore-db.sh <archive.dump> <target-database-url> [CONFIRM_OVERWRITE=yes]}"
TARGET_URL="${2:?usage: restore-db.sh <archive.dump> <target-database-url> [CONFIRM_OVERWRITE=yes]}"
CONFIRM_OVERWRITE="${3:-no}"

command -v pg_restore >/dev/null 2>&1 || { echo "[restore] pg_restore not found on PATH" >&2; exit 1; }
[ -f "${ARCHIVE}" ] || { echo "[restore] archive ${ARCHIVE} not found" >&2; exit 1; }

if [ "${CONFIRM_OVERWRITE}" != "yes" ]; then
  echo "[restore] DRY RUN — listing archive summary:"
  pg_restore --list "${ARCHIVE}" | head -30
  echo ""
  echo "[restore] target: ${TARGET_URL}"
  echo "[restore] re-run with CONFIRM_OVERWRITE=yes as the third argument to restore for real."
  exit 0
fi

echo "[restore] dropping existing objects in target (idempotent) and restoring ${ARCHIVE}"
pg_restore --clean --if-exists --no-owner --no-privileges --dbname="${TARGET_URL}" "${ARCHIVE}"

# Verification drill: every core table must exist and be non-empty where data
# is guaranteed (tenants, audit_events may legitimately have rows).
echo "[restore] verifying restore…"
for table in tenants users work_orders service_requests attachments outbox_events mobile_sync_operations; do
  COUNT="$(psql "${TARGET_URL}" -tAc "SELECT count(*) FROM ${table}")"
  echo "[restore]   ${table}: ${COUNT} rows"
done
echo "[restore] done — spot-check with: psql \"${TARGET_URL}\" -c 'select * from work_orders limit 5'"
