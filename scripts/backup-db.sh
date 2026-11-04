#!/usr/bin/env bash
# ServiceOS — PostgreSQL backup (audit INFRA-06).
#
# Creates a custom-format pg_dump (compressed, restorable selectively),
# verifies it, prunes old backups and optionally ships them to S3.
#
# Usage:
#   DATABASE_URL=postgresql://user:pass@host:5432/serviceos \
#   BACKUP_DIR=/var/backups/serviceos S3_BACKUP_BUCKET=serviceos-backups \
#   ./scripts/backup-db.sh
#
# Cron example (02:30 daily, keeping 14 local + infinite offsite):
#   30 2 * * * DATABASE_URL=... /opt/serviceos/scripts/backup-db.sh >> /var/log/serviceos-backup.log 2>&1
#
# RDS users: automated daily snapshots + PITR are configured in Terraform
# (backup_retention_period, aws_db_instance) — this script is the portable
# logical backup layer on top (works for compose, ECS and RDS alike).
set -euo pipefail

DATABASE_URL="${DATABASE_URL:?DATABASE_URL must point at the ServiceOS database}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
S3_BACKUP_BUCKET="${S3_BACKUP_BUCKET:-}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="${BACKUP_DIR}/serviceos-${TIMESTAMP}.dump"

command -v pg_dump >/dev/null 2>&1 || {
  echo "[backup] pg_dump not found on PATH." >&2
  echo "[backup] Compose deployments: docker compose -f docker-compose.prod.yml exec postgres pg_dump ..." >&2
  exit 1
}

mkdir -p "${BACKUP_DIR}"
echo "[backup] dumping to ${TARGET}"
pg_dump --format=custom --compress=6 --no-owner --no-privileges "${DATABASE_URL}" > "${TARGET}"

# Integrity check: the archive must list every tenant-owned core table.
REQUIRED_TABLES="tenants users work_orders service_requests attachments outbox_events"
LISTING="$(pg_restore --list "${TARGET}")"
for table in ${REQUIRED_TABLES}; do
  echo "${LISTING}" | grep -q "TABLE.* ${table} " || {
    echo "[backup] VERIFICATION FAILED: table ${table} missing from ${TARGET}" >&2
    rm -f "${TARGET}"
    exit 1
  }
done
echo "[backup] verified: core tables present ($(du -h "${TARGET}" | cut -f1))"

if [ -n "${S3_BACKUP_BUCKET}" ]; then
  command -v aws >/dev/null 2>&1 || { echo "[backup] aws CLI missing — skipping offsite copy" >&2; exit 0; }
  aws s3 cp "${TARGET}" "s3://${S3_BACKUP_BUCKET}/database/${TIMESTAMP}.dump" --sse AES256
  echo "[backup] copied offsite to s3://${S3_BACKUP_BUCKET}/database/${TIMESTAMP}.dump"
fi

# Local retention pruning (offsite copies are governed by the bucket policy).
find "${BACKUP_DIR}" -name 'serviceos-*.dump' -mtime "+${RETENTION_DAYS}" -delete
echo "[backup] pruned local backups older than ${RETENTION_DAYS} days"
