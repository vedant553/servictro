-- AlterTable
ALTER TABLE "asset_documents" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;

-- AlterTable
ALTER TABLE "assets" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;

-- AlterTable
ALTER TABLE "attachments" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;

-- AlterTable
ALTER TABLE "audit_events" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;

-- AlterTable
ALTER TABLE "checklist_template_versions" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;

-- AlterTable
ALTER TABLE "checklist_templates" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;

-- AlterTable
ALTER TABLE "contract_assets" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;

-- AlterTable
ALTER TABLE "customer_accounts" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;

-- AlterTable
ALTER TABLE "customer_contacts" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;

-- AlterTable
ALTER TABLE "idempotency_keys" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;

-- AlterTable
ALTER TABLE "maintenance_plan_assets" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;

-- AlterTable
ALTER TABLE "maintenance_plans" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;

-- AlterTable
ALTER TABLE "mobile_sync_operations" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;

-- AlterTable
ALTER TABLE "notification_deliveries" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;

-- AlterTable
ALTER TABLE "notifications" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;

-- AlterTable
ALTER TABLE "number_sequences" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;

-- AlterTable
ALTER TABLE "outbox_events" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;

-- AlterTable
ALTER TABLE "parts_usage" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;

-- AlterTable
ALTER TABLE "planned_visits" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;

-- AlterTable
ALTER TABLE "service_contracts" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;

-- AlterTable
ALTER TABLE "service_measurements" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;

-- AlterTable
ALTER TABLE "service_observations" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;

-- AlterTable
ALTER TABLE "service_reports" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;

-- AlterTable
ALTER TABLE "service_requests" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;

-- AlterTable
ALTER TABLE "sites" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;

-- AlterTable
ALTER TABLE "work_order_assignments" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;

-- AlterTable
ALTER TABLE "work_order_checklist_results" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;

-- AlterTable
ALTER TABLE "work_order_events" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;

-- AlterTable
ALTER TABLE "work_orders" ALTER COLUMN "tenant_id" SET DEFAULT current_setting('app.tenant_id', true)::uuid;
