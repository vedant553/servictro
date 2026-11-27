#!/usr/bin/env bash
# ServiceOS — local PostgreSQL 17 lifecycle (embedded binaries, no root needed).
# Usage: scripts/pg.sh start|stop|status|reset
#
# The @embedded-postgres/linux-x64 package ships only postgres/initdb/pg_ctl
# (no psql), so role/database provisioning runs through node-postgres.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$PROJECT_DIR/mini-services/serviceos-api"
# Bun hoists workspace deps to the root node_modules; check both locations.
PG_BIN_DIR=""
for candidate in \
  "$API_DIR/node_modules/@embedded-postgres/linux-x64/native/bin" \
  "$PROJECT_DIR/node_modules/@embedded-postgres/linux-x64/native/bin"; do
  if [ -x "$candidate/pg_ctl" ]; then
    PG_BIN_DIR="$candidate"
    break
  fi
done

PG_DATA="$PROJECT_DIR/.pgdata"
PG_RUN="$PROJECT_DIR/.pgdata/run"
PG_PORT="${PG_PORT:-5433}"
PG_HOST="127.0.0.1"
PG_SUPERUSER="postgres"
PG_SUPERUSER_PASSWORD="postgres"
APP_DB="serviceos"
TEST_DB="serviceos_test"
APP_ROLE="serviceos_app"
APP_ROLE_PASSWORD="serviceos_app_dev"
WORKER_ROLE="serviceos_worker"
WORKER_ROLE_PASSWORD="serviceos_worker_dev"

# Execute SQL statements as the bootstrap superuser via node-postgres
# (the embedded package ships no psql). Query results print as JSON lines.
sql_super() {
  (
    cd "$API_DIR"
    PG_HOST="$PG_HOST" PG_PORT="$PG_PORT" node -e '
      const { Client } = require("pg");
      (async () => {
        const c = new Client({ host: process.env.PG_HOST, port: Number(process.env.PG_PORT), user: "postgres", password: "postgres", database: "postgres" });
        await c.connect();
        for (const stmt of process.argv.slice(1)) {
          const res = await c.query(stmt);
          if (res.rows.length) console.log(JSON.stringify(res.rows));
        }
        await c.end();
      })().catch((e) => { console.error(e.message); process.exit(1); });
    ' "$@"
  )
}

require_binaries() {
  if [ -z "$PG_BIN_DIR" ]; then
    echo "[pg] PostgreSQL binaries not found (looked in api + root node_modules)"
    echo "[pg] Run: (cd $PROJECT_DIR && bun install)"
    exit 1
  fi
}

is_running() {
  "$PG_BIN_DIR/pg_ctl" -D "$PG_DATA" status >/dev/null 2>&1
}

do_initdb() {
  echo "[pg] Initializing cluster at $PG_DATA (port $PG_PORT)"
  rm -rf "$PG_DATA"
  mkdir -p "$PG_DATA"
  "$PG_BIN_DIR/initdb" -D "$PG_DATA" -U "$PG_SUPERUSER" \
    --pwfile=<(printf '%s\n' "$PG_SUPERUSER_PASSWORD") \
    --auth-host=scram-sha-256 --auth-local=trust -E UTF8 >/dev/null
  # The run dir must be created AFTER initdb — initdb refuses a non-empty target.
  mkdir -p "$PG_RUN"
  cat >>"$PG_DATA/postgresql.conf" <<EOF
port = $PG_PORT
listen_addresses = '$PG_HOST'
unix_socket_directories = '$PG_RUN'
max_connections = 60
shared_buffers = 64MB
EOF
}

provision() {
  echo "[pg] Provisioning roles and databases"
  sql_super "DO \$\$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'serviceos_migrate') THEN
      CREATE ROLE serviceos_migrate LOGIN PASSWORD 'serviceos_migrate_dev' CREATEROLE BYPASSRLS;
    END IF;
  END \$\$;"
  sql_super "DO \$\$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$APP_ROLE') THEN
      CREATE ROLE $APP_ROLE LOGIN PASSWORD '$APP_ROLE_PASSWORD' NOSUPERUSER NOCREATEDB NOCREATEROLE;
    END IF;
  END \$\$;"
  # Worker role exists from the audit remediation migration (NOLOGIN, least
  # privilege); dev only enables LOGIN with the documented dev password.
  sql_super "DO \$\$ BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = '$WORKER_ROLE') THEN
      ALTER ROLE $WORKER_ROLE LOGIN PASSWORD '$WORKER_ROLE_PASSWORD';
    END IF;
  END \$\$;"
  local exists
  exists=$(sql_super "SELECT count(*)::int AS n FROM pg_database WHERE datname = '$APP_DB'")
  [ -z "$(echo "$exists" | grep '\"n\":0')" ] || sql_super "CREATE DATABASE $APP_DB OWNER $PG_SUPERUSER"
  exists=$(sql_super "SELECT count(*)::int AS n FROM pg_database WHERE datname = '$TEST_DB'")
  [ -z "$(echo "$exists" | grep '\"n\":0')" ] || sql_super "CREATE DATABASE $TEST_DB OWNER $PG_SUPERUSER"
  # Match scripts/db-bootstrap-roles.sql: the migration role owns the app
  # databases and their public schemas (Postgres 15+ revoked public CREATE),
  # and can alter default privileges for the roles the migrations grant to.
  for DB in "$APP_DB" "$TEST_DB"; do
    sql_super "ALTER DATABASE $DB OWNER TO serviceos_migrate"
    (
      cd "$API_DIR"
      PG_HOST="$PG_HOST" PG_PORT="$PG_PORT" node -e '
        const { Client } = require("pg");
        (async () => {
          const c = new Client({ host: process.env.PG_HOST, port: Number(process.env.PG_PORT), user: "postgres", password: "postgres", database: process.argv[1] });
          await c.connect();
          await c.query("ALTER SCHEMA public OWNER TO serviceos_migrate");
          await c.query("GRANT serviceos_app TO serviceos_migrate").catch(() => undefined);
          await c.end();
        })().catch((e) => { console.error(e.message); process.exit(1); });
      ' "$DB"
    )
  done
  echo "[pg] roles: serviceos_migrate (bootstrap, BYPASSRLS), $APP_ROLE, $WORKER_ROLE (least privilege) / databases: $APP_DB, $TEST_DB"
}

start() {
  require_binaries
  if is_running; then
    echo "[pg] Already running on port $PG_PORT"
    provision
    return 0
  fi
  [ -f "$PG_DATA/PG_VERSION" ] || do_initdb
  mkdir -p "$PG_RUN"
  echo "[pg] Starting PostgreSQL on $PG_HOST:$PG_PORT"
  "$PG_BIN_DIR/pg_ctl" -D "$PG_DATA" -l "$PG_RUN/postgres.log" \
    -o "-k $PG_RUN" -w start >/dev/null
  for _ in $(seq 1 30); do
    if sql_super "SELECT 1" >/dev/null 2>&1; then break; fi
    sleep 1
  done
  provision
  echo "[pg] Ready — app URL: postgresql://$APP_ROLE:***@$PG_HOST:$PG_PORT/$APP_DB"
}

stop() {
  require_binaries
  if is_running; then
    echo "[pg] Stopping PostgreSQL"
    "$PG_BIN_DIR/pg_ctl" -D "$PG_DATA" -m fast stop >/dev/null
    echo "[pg] Stopped"
  else
    echo "[pg] Not running"
  fi
}

status() {
  if is_running; then
    echo "[pg] RUNNING on port $PG_PORT (data: $PG_DATA)"
  else
    echo "[pg] STOPPED (data: $PG_DATA)"
  fi
}

reset() {
  stop || true
  rm -rf "$PG_DATA"
  echo "[pg] Data directory removed"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  reset) reset ;;
  *) echo "Usage: $0 start|stop|status|reset"; exit 1 ;;
esac
