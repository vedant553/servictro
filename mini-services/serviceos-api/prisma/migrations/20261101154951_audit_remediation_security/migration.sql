-- ServiceOS migration — engineering audit remediation (SEC-03, SEC-06, DATA-05, DATA-06, INFRA-07).
--
-- 1. Least-privilege database role for the background worker (SEC-03):
--    `serviceos_worker` may ONLY claim/update outbox events, read maintenance
--    plans and service contracts, and update its heartbeat. No DDL, no INSERT,
--    no DELETE, no access to customer/asset/user data. Cross-tenant reads are
--    granted explicitly per table via role-targeted RLS policies (OR-combined
--    with the tenant policy — serviceos_app keeps tenant-scoped access only).
--    The role is created NOLOGIN; operators enable LOGIN with a password from
--    a secret store (scripts/db-bootstrap-roles.sql, docs/DEPLOYMENT.md).
-- 2. Outbox claim lease columns (DATA-06): locked_until/locked_by, claimed
--    atomically with SELECT ... FOR UPDATE SKIP LOCKED by the worker.
-- 3. Notification deduplication (DATA-05): dedup_key with a unique partial
--    index per (tenant, user) — repeat reminder passes are idempotent.
-- 4. Worker heartbeat table (INFRA-07): singleton row the worker updates;
--    /health/worker reports pass freshness.

-- ---------------------------------------------------------------------------
-- 1. Outbox claim lease + notification dedup columns
-- ---------------------------------------------------------------------------
ALTER TABLE "outbox_events"
  ADD COLUMN "locked_by" TEXT,
  ADD COLUMN "locked_until" TIMESTAMPTZ(6);

ALTER TABLE "notifications" ADD COLUMN "dedup_key" TEXT;

DROP INDEX IF EXISTS "outbox_events_published_at_created_at_idx";
CREATE INDEX "outbox_events_published_at_attempts_locked_until_idx"
  ON "outbox_events"("published_at", "attempts", "locked_until");
CREATE INDEX "outbox_events_claim_idx"
  ON "outbox_events"("locked_until")
  WHERE "published_at" IS NULL AND "attempts" < 10;

CREATE UNIQUE INDEX "notifications_dedup_uq"
  ON "notifications"("tenant_id", "user_id", "dedup_key")
  WHERE "dedup_key" IS NOT NULL;

CREATE INDEX "mobile_sync_operations_user_id_received_at_idx"
  ON "mobile_sync_operations"("user_id", "received_at");

-- ---------------------------------------------------------------------------
-- 2. Worker heartbeat table (platform scope: no tenant_id, no RLS)
-- ---------------------------------------------------------------------------
CREATE TABLE "worker_heartbeats" (
  "id" TEXT NOT NULL DEFAULT 'singleton',
  "worker_id" TEXT NOT NULL,
  "last_outbox_poll_at" TIMESTAMPTZ(6),
  "last_pm_pass_at" TIMESTAMPTZ(6),
  "last_renewal_pass_at" TIMESTAMPTZ(6),
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("id")
);

INSERT INTO "worker_heartbeats" ("id", "worker_id", "updated_at")
  VALUES ('singleton', 'bootstrap', now())
  ON CONFLICT ("id") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Least-privilege worker role (SEC-03)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'serviceos_worker') THEN
    CREATE ROLE serviceos_worker NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO serviceos_worker;
GRANT SELECT, UPDATE ON TABLE outbox_events TO serviceos_worker;
GRANT SELECT ON TABLE maintenance_plans TO serviceos_worker;
GRANT SELECT ON TABLE service_contracts TO serviceos_worker;
GRANT UPDATE ON TABLE worker_heartbeats TO serviceos_worker;

-- Role-targeted RLS policies (OR-combined with the existing tenant policy):
-- the worker role may claim/see outbox events and read plan/contract headers
-- across tenants; every other role keeps only tenant-scoped access.
CREATE POLICY outbox_events_worker_select ON outbox_events
  FOR SELECT TO serviceos_worker USING (true);
CREATE POLICY outbox_events_worker_update ON outbox_events
  FOR UPDATE TO serviceos_worker USING (true) WITH CHECK (true);
CREATE POLICY maintenance_plans_worker_select ON maintenance_plans
  FOR SELECT TO serviceos_worker USING (true);
CREATE POLICY service_contracts_worker_select ON service_contracts
  FOR SELECT TO serviceos_worker USING (true);

-- The app role (API) reads the heartbeat for /health/worker.
GRANT SELECT ON TABLE worker_heartbeats TO serviceos_app;
