-- ServiceOS migration 2 — multi-tenant security hardening (ADR-005).
--
-- 1. Row-Level Security on every tenant-owned table: FORCE RLS + a policy
--    reading the transaction-local `app.tenant_id` set by TenantDbService.
--    The API connects as the non-owner role `serviceos_app`; the migration
--    role (owner) and superusers bypass RLS for bootstrap/maintenance only.
-- 2. Least-privilege grants for the app role + default privileges so future
--    tables created by migrations are covered automatically.
-- 3. CHECK constraints for business invariants Prisma cannot express.
-- 4. Partial indexes for hot operational queries (Tech Spec §25.1).

-- ---------------------------------------------------------------------------
-- 1. Row-Level Security
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'customer_accounts',
    'customer_contacts',
    'sites',
    'assets',
    'attachments',
    'asset_documents',
    'service_contracts',
    'contract_assets',
    'maintenance_plans',
    'maintenance_plan_assets',
    'planned_visits',
    'service_requests',
    'work_orders',
    'work_order_assignments',
    'work_order_events',
    'checklist_templates',
    'checklist_template_versions',
    'work_order_checklist_results',
    'service_measurements',
    'service_observations',
    'parts_usage',
    'service_reports',
    'notifications',
    'notification_deliveries',
    'audit_events',
    'outbox_events',
    'idempotency_keys',
    'mobile_sync_operations',
    'number_sequences'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;

-- Platform-scope tables (tenants, users, tenant_memberships, invitations,
-- refresh_tokens) intentionally have NO RLS: identity resolution must work
-- before a tenant context exists. Application-layer scoping applies there.

-- ---------------------------------------------------------------------------
-- 2. App role grants (least privilege: no DDL, no truncation)
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO serviceos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO serviceos_app;
-- Future tables created by the migration role inherit the same grants.
-- NOTE: no `FOR ROLE postgres` clause — default privileges bind to the role
-- that actually runs the migration (serviceos_migrate in dev/production,
-- postgres in CI), so tables get the app-role grants in every environment.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO serviceos_app;

-- ---------------------------------------------------------------------------
-- 3. Business invariant CHECK constraints
-- ---------------------------------------------------------------------------
ALTER TABLE service_contracts
  ADD CONSTRAINT service_contracts_dates_check CHECK (end_date >= start_date),
  ADD CONSTRAINT service_contracts_amount_check CHECK (amount_minor IS NULL OR amount_minor >= 0),
  ADD CONSTRAINT service_contracts_response_target_check CHECK (response_target_minutes IS NULL OR response_target_minutes > 0),
  ADD CONSTRAINT service_contracts_resolution_target_check CHECK (resolution_target_minutes IS NULL OR resolution_target_minutes > 0);

ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_schedule_window_check
  CHECK (scheduled_end_at IS NULL OR scheduled_start_at IS NULL OR scheduled_end_at > scheduled_start_at);

ALTER TABLE maintenance_plans
  ADD CONSTRAINT maintenance_plans_dates_check CHECK (end_date IS NULL OR end_date >= start_date);

ALTER TABLE contract_assets
  ADD CONSTRAINT contract_assets_included_visits_check CHECK (included_visits IS NULL OR included_visits >= 0);

ALTER TABLE attachments
  ADD CONSTRAINT attachments_size_check CHECK (size_bytes > 0);

ALTER TABLE parts_usage
  ADD CONSTRAINT parts_usage_quantity_check CHECK (quantity > 0);

ALTER TABLE service_measurements
  ADD CONSTRAINT service_measurements_value_check CHECK (measured_value >= 0 OR measurement_key NOT IN ('insulation_resistance_mohm'));
-- Note: negative readings are legitimate for some keys; the constraint above
-- is intentionally permissive and documented for review with pilot data.

-- ---------------------------------------------------------------------------
-- 4. Partial indexes for operational queries
-- ---------------------------------------------------------------------------
CREATE INDEX work_orders_open_due_idx
  ON work_orders (tenant_id, resolution_due_at)
  WHERE status NOT IN ('closed', 'cancelled');

CREATE INDEX outbox_unpublished_idx
  ON outbox_events (created_at)
  WHERE published_at IS NULL;

CREATE INDEX notifications_unread_idx
  ON notifications (tenant_id, user_id)
  WHERE read_at IS NULL;

CREATE INDEX planned_visits_open_idx
  ON planned_visits (tenant_id, due_at)
  WHERE status IN ('planned', 'scheduled');
