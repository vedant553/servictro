import { execSync } from 'node:child_process';
import { Client } from 'pg';

/**
 * Global test setup: apply migrations to the test database (as the owner
 * role), enable the least-privilege worker role's LOGIN (created NOLOGIN by
 * the migration — same as scripts/pg.sh does for development), and truncate
 * all data so every run starts clean.
 */
export default async function globalSetup(): Promise<void> {
  const host = process.env.TEST_PG_HOST ?? '127.0.0.1';
  const port = process.env.TEST_PG_PORT ?? '5433';
  const ownerUrl = `postgresql://postgres:postgres@${host}:${port}/serviceos_test`;
  execSync('bunx tsc -p tsconfig.build.json', {
    cwd: __dirname + '/..',
    stdio: 'pipe',
  });
  execSync('bunx prisma migrate deploy', {
    cwd: __dirname + '/..',
    env: { ...process.env, DATABASE_URL: ownerUrl, DATABASE_MIGRATE_URL: ownerUrl },
    stdio: 'pipe',
  });

  const tables = [
    'tenants', 'users', 'tenant_memberships', 'invitations', 'refresh_tokens', 'number_sequences',
    'customer_accounts', 'customer_contacts', 'sites', 'assets', 'attachments', 'asset_documents',
    'service_contracts', 'contract_assets', 'maintenance_plans', 'maintenance_plan_assets', 'planned_visits',
    'service_requests', 'work_orders', 'work_order_assignments', 'work_order_events',
    'checklist_templates', 'checklist_template_versions', 'work_order_checklist_results',
    'service_measurements', 'service_observations', 'parts_usage', 'service_reports',
    'notifications', 'notification_deliveries', 'audit_events', 'outbox_events',
    'idempotency_keys', 'mobile_sync_operations',
  ];
  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  // Worker role LOGIN with the documented dev password (idempotent — the
  // role itself is created by the migration; roles are cluster-scoped).
  await client
    .query("DO $$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname='serviceos_worker') THEN ALTER ROLE serviceos_worker LOGIN PASSWORD 'serviceos_worker_dev'; END IF; END $$;")
    .catch(() => undefined);
  await client.query(`TRUNCATE ${tables.join(', ')} CASCADE`);
  // Reset the worker heartbeat singleton (operational metadata, not test data).
  await client.query(`UPDATE worker_heartbeats SET worker_id = 'bootstrap' WHERE id = 'singleton'`);
  await client.end();
}
