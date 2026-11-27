-- ServiceOS — database role bootstrap (audit SEC-03 / INFRA-08).
--
-- Executed ONCE by an operator with cluster privileges (RDS master user or
-- the docker postgres superuser — see docker-compose.dev.yml initdb mount):
--
--   psql "$MASTER_URL" -f scripts/db-bootstrap-roles.sql
--
-- Roles follow least privilege:
--   serviceos_migrate — owns the schema; runs `prisma migrate` and the dev
--   seed only (BYPASSRLS: FORCE ROW LEVEL SECURITY subjects even the table
--   owner, so the bootstrap role needs an explicit bypass; never used by a
--   runtime process)
--   serviceos_app     — API process: DML on all tables, RLS-enforced tenant rows
--   serviceos_worker  — background worker: claim/update outbox events, read
--                       plans/contracts, update its heartbeat. NOTHING else.
-- The migration 20261101154951 creates serviceos_worker's table grants and
-- RLS policies; this script only provisions the LOGIN credentials.
--
-- Replace the three CHANGE_ME_1..3 values with secrets from your secret store
-- before applying (generate: node -e "console.log(require('crypto').randomBytes(24).toString('hex'))").

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'serviceos_migrate') THEN
    CREATE ROLE serviceos_migrate LOGIN PASSWORD 'CHANGE_ME_1' CREATEROLE BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'serviceos_app') THEN
    CREATE ROLE serviceos_app LOGIN PASSWORD 'CHANGE_ME_2' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
  -- serviceos_worker is created NOLOGIN by the migration; enable LOGIN here.
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'serviceos_worker') THEN
    ALTER ROLE serviceos_worker LOGIN PASSWORD 'CHANGE_ME_3';
  ELSE
    CREATE ROLE serviceos_worker LOGIN PASSWORD 'CHANGE_ME_3' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

-- The migration role owns application objects. For an existing database the
-- API role's table grants are managed by migrations; this script is the
-- bootstrap for a FRESH cluster before the first `prisma migrate deploy`.
GRANT USAGE ON SCHEMA public TO serviceos_migrate, serviceos_app, serviceos_worker;

-- Postgres 15+ revoked CREATE on the public schema from non-owners: without
-- ownership the first `prisma migrate deploy` fails with
-- "permission denied for schema public". The migration role must own the
-- application database and its public schema (runs connected to `serviceos`).
ALTER DATABASE serviceos OWNER TO serviceos_migrate;
ALTER SCHEMA public OWNER TO serviceos_migrate;

-- Migrations contain `ALTER DEFAULT PRIVILEGES ... TO serviceos_app/worker`;
-- altering another role's default privileges requires membership in it.
GRANT serviceos_app TO serviceos_migrate;
GRANT serviceos_worker TO serviceos_migrate;
