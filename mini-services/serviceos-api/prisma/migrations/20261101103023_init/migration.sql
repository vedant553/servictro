-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('active', 'suspended', 'closed');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('invited', 'active', 'suspended', 'revoked');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('pending', 'accepted', 'expired', 'revoked');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('owner', 'admin', 'service_manager', 'coordinator', 'technician', 'contract_admin', 'auditor');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('active', 'inactive', 'archived');

-- CreateEnum
CREATE TYPE "SiteStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "AssetFamily" AS ENUM ('lt_panel', 'ht_switchgear', 'vcb_panel', 'rmu', 'pcc', 'mcc', 'apfc', 'busduct', 'transformer', 'other');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('active', 'inactive', 'decommissioned');

-- CreateEnum
CREATE TYPE "AssetDocumentType" AS ENUM ('single_line_diagram', 'ga_drawing', 'test_certificate', 'om_manual', 'commissioning_report', 'warranty_certificate', 'nameplate_photo', 'other');

-- CreateEnum
CREATE TYPE "AttachmentStatus" AS ENUM ('pending', 'available', 'quarantined', 'deleted');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('pending', 'clean', 'infected', 'failed');

-- CreateEnum
CREATE TYPE "RequestSource" AS ENUM ('phone', 'email', 'portal', 'whatsapp', 'walk_in', 'internal');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('new', 'triaged', 'accepted', 'needs_information', 'converted', 'rejected', 'closed');

-- CreateEnum
CREATE TYPE "RequestCategory" AS ENUM ('breakdown', 'tripping', 'overheating', 'abnormal_sound', 'preventive_visit', 'inspection', 'retrofit', 'spares', 'documentation', 'other');

-- CreateEnum
CREATE TYPE "WorkOrderType" AS ENUM ('breakdown', 'preventive', 'installation', 'commissioning', 'inspection', 'retrofit');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('draft', 'ready', 'scheduled', 'in_progress', 'on_hold', 'pending_review', 'completed', 'closed', 'cancelled');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('offered', 'accepted', 'rejected', 'active', 'completed');

-- CreateEnum
CREATE TYPE "WorkOrderEventType" AS ENUM ('created', 'status_changed', 'assigned', 'unassigned', 'checklist_saved', 'observation_added', 'measurement_added', 'parts_recorded', 'report_generated', 'report_published', 'acknowledgement_captured', 'note_added');

-- CreateEnum
CREATE TYPE "ChecklistOutcome" AS ENUM ('pass', 'fail', 'not_applicable', 'not_checked', 'exception');

-- CreateEnum
CREATE TYPE "AcknowledgementMethod" AS ENUM ('signature', 'name_confirmation', 'not_signed');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('warranty', 'amc', 'service');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('draft', 'active', 'expired', 'terminated', 'renewed');

-- CreateEnum
CREATE TYPE "CoverageType" AS ENUM ('full', 'labour_only', 'inspection_only', 'parts_only');

-- CreateEnum
CREATE TYPE "RenewalStatus" AS ENUM ('not_due', 'due_soon', 'in_progress', 'renewed', 'lost');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('draft', 'active', 'paused', 'archived');

-- CreateEnum
CREATE TYPE "PlannedVisitStatus" AS ENUM ('planned', 'scheduled', 'completed', 'skipped', 'cancelled');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('draft', 'pending_review', 'approved', 'published', 'superseded');

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('request_created', 'request_assigned_triage', 'work_order_assigned', 'work_order_status', 'sla_at_risk', 'pm_due', 'amc_renewal', 'report_published', 'membership', 'system');

-- CreateEnum
CREATE TYPE "DeliveryChannel" AS ENUM ('in_app', 'email', 'whatsapp');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('pending', 'sent', 'failed', 'skipped_dev_no_provider');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "locale" TEXT NOT NULL DEFAULT 'en-IN',
    "currency_code" CHAR(3) NOT NULL DEFAULT 'INR',
    "status" "TenantStatus" NOT NULL DEFAULT 'active',
    "plan" TEXT NOT NULL DEFAULT 'trial',
    "subscription_status" TEXT NOT NULL DEFAULT 'trialing',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "phone" TEXT,
    "password_hash" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "identity_issuer" TEXT,
    "identity_subject" TEXT,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_memberships" (
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'invited',
    "title" TEXT,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "invited_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY ("tenant_id","user_id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'pending',
    "invited_by_id" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "accepted_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "replaced_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_sequences" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    "prefix" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_accounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_code" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "segment" TEXT,
    "status" "CustomerStatus" NOT NULL DEFAULT 'active',
    "billing_address" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_contacts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "site_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "SiteStatus" NOT NULL DEFAULT 'active',
    "address" JSONB NOT NULL DEFAULT '{}',
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "access_instructions" TEXT,
    "operating_hours" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "parent_asset_id" UUID,
    "asset_code" TEXT NOT NULL,
    "serial_number" TEXT,
    "asset_family" "AssetFamily" NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "commissioning_date" DATE,
    "specification_schema_version" INTEGER NOT NULL DEFAULT 1,
    "specification" JSONB NOT NULL DEFAULT '{}',
    "status" "AssetStatus" NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum_sha256" TEXT NOT NULL,
    "scan_status" "ScanStatus" NOT NULL DEFAULT 'pending',
    "status" "AttachmentStatus" NOT NULL DEFAULT 'pending',
    "owner_type" TEXT,
    "owner_id" UUID,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "attachment_id" UUID NOT NULL,
    "document_type" "AssetDocumentType" NOT NULL,
    "title" TEXT,
    "revision" TEXT,
    "notes" TEXT,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "asset_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_contracts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "contract_no" TEXT NOT NULL,
    "contract_type" "ContractType" NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'draft',
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "currency_code" CHAR(3) NOT NULL DEFAULT 'INR',
    "amount_minor" BIGINT,
    "response_target_minutes" INTEGER,
    "resolution_target_minutes" INTEGER,
    "included_visits_per_year" INTEGER,
    "terms" JSONB NOT NULL DEFAULT '{}',
    "renewal_status" "RenewalStatus" NOT NULL DEFAULT 'not_due',
    "renewal_notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "service_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_assets" (
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "coverage_type" "CoverageType" NOT NULL DEFAULT 'full',
    "included_visits" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_assets_pkey" PRIMARY KEY ("tenant_id","contract_id","asset_id")
);

-- CreateTable
CREATE TABLE "maintenance_plans" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID,
    "plan_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "asset_family" "AssetFamily" NOT NULL,
    "recurrence" JSONB NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "horizon_days" INTEGER NOT NULL DEFAULT 90,
    "lead_days" INTEGER NOT NULL DEFAULT 14,
    "checklist_template_id" UUID,
    "status" "PlanStatus" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "maintenance_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_plan_assets" (
    "tenant_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_plan_assets_pkey" PRIMARY KEY ("tenant_id","plan_id","asset_id")
);

-- CreateTable
CREATE TABLE "planned_visits" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "PlannedVisitStatus" NOT NULL DEFAULT 'planned',
    "work_order_id" UUID,
    "generation_key" TEXT NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "planned_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "request_no" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "asset_id" UUID,
    "contact_id" UUID,
    "source" "RequestSource" NOT NULL,
    "category" "RequestCategory" NOT NULL DEFAULT 'other',
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "Severity" NOT NULL DEFAULT 'medium',
    "status" "RequestStatus" NOT NULL DEFAULT 'new',
    "preferred_visit_at" TIMESTAMPTZ(6),
    "first_response_at" TIMESTAMPTZ(6),
    "triaged_at" TIMESTAMPTZ(6),
    "triaged_by_id" UUID,
    "accepted_at" TIMESTAMPTZ(6),
    "rejected_reason" TEXT,
    "converted_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "created_by_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "work_order_no" TEXT NOT NULL,
    "request_id" UUID,
    "customer_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "asset_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "WorkOrderType" NOT NULL DEFAULT 'breakdown',
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'draft',
    "priority" "Priority" NOT NULL DEFAULT 'normal',
    "scheduled_start_at" TIMESTAMPTZ(6),
    "scheduled_end_at" TIMESTAMPTZ(6),
    "response_due_at" TIMESTAMPTZ(6),
    "resolution_due_at" TIMESTAMPTZ(6),
    "slaPolicy" JSONB,
    "checklist_template_version_id" UUID,
    "required_skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "completion_summary" TEXT,
    "cancelled_reason" TEXT,
    "completed_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_assignments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "assignment_role" TEXT NOT NULL DEFAULT 'technician',
    "status" "AssignmentStatus" NOT NULL DEFAULT 'offered',
    "offered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "work_order_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "event_type" "WorkOrderEventType" NOT NULL,
    "from_status" "WorkOrderStatus",
    "to_status" "WorkOrderStatus",
    "actor_user_id" UUID,
    "reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_templates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "template_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "asset_family" "AssetFamily" NOT NULL,
    "active_version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "checklist_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_template_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklist_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_checklist_results" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "template_version_id" UUID NOT NULL,
    "item_key" TEXT NOT NULL,
    "outcome" "ChecklistOutcome" NOT NULL DEFAULT 'not_checked',
    "value_numeric" DECIMAL(18,4),
    "value_text" TEXT,
    "unit" TEXT,
    "note" TEXT,
    "exception_reason" TEXT,
    "performed_by_id" UUID,
    "observed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "work_order_checklist_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_measurements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "asset_id" UUID,
    "measurement_key" TEXT NOT NULL,
    "measured_value" DECIMAL(18,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "phase" TEXT,
    "instrument_id" TEXT,
    "calibration_reference" TEXT,
    "note" TEXT,
    "device_observed_at" TIMESTAMPTZ(6),
    "server_received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recorded_by_id" UUID,

    CONSTRAINT "service_measurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_observations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'observation',
    "text" TEXT NOT NULL,
    "device_observed_at" TIMESTAMPTZ(6),
    "recorded_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parts_usage" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "part_code" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'nos',
    "serial_or_batch" TEXT,
    "note" TEXT,
    "recorded_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parts_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_reports" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "report_version" INTEGER NOT NULL DEFAULT 1,
    "status" "ReportStatus" NOT NULL DEFAULT 'draft',
    "template_version" TEXT NOT NULL DEFAULT 'v1',
    "summary" TEXT,
    "generated_attachment_id" UUID,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "supersedes_report_id" UUID,
    "acknowledged_by_name" TEXT,
    "acknowledged_by_role" TEXT,
    "acknowledged_at" TIMESTAMPTZ(6),
    "acknowledgement_method" "AcknowledgementMethod",
    "signature_attachment_id" UUID,
    "not_signed_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "service_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" UUID,
    "link" TEXT,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "channel" "DeliveryChannel" NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'pending',
    "provider_message_id" TEXT,
    "error" TEXT,
    "attempted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID NOT NULL,
    "reason" TEXT,
    "request_id" TEXT,
    "ip_hash" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "published_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("tenant_id","key")
);

-- CreateTable
CREATE TABLE "mobile_sync_operations" (
    "tenant_id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "result" TEXT NOT NULL,
    "server_version" INTEGER,
    "response_payload" JSONB,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mobile_sync_operations_pkey" PRIMARY KEY ("tenant_id","operation_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_identity_issuer_identity_subject_key" ON "users"("identity_issuer", "identity_subject");

-- CreateIndex
CREATE INDEX "tenant_memberships_user_id_idx" ON "tenant_memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_tenant_id_status_idx" ON "invitations"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "number_sequences_tenant_id_key_key" ON "number_sequences"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "customer_accounts_tenant_id_status_created_at_idx" ON "customer_accounts"("tenant_id", "status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "customer_accounts_tenant_id_id_key" ON "customer_accounts"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_accounts_tenant_id_account_code_key" ON "customer_accounts"("tenant_id", "account_code");

-- CreateIndex
CREATE INDEX "customer_contacts_tenant_id_customer_id_idx" ON "customer_contacts"("tenant_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_contacts_tenant_id_id_key" ON "customer_contacts"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "sites_tenant_id_customer_id_idx" ON "sites"("tenant_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "sites_tenant_id_id_key" ON "sites"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sites_tenant_id_site_code_key" ON "sites"("tenant_id", "site_code");

-- CreateIndex
CREATE INDEX "assets_tenant_id_site_id_idx" ON "assets"("tenant_id", "site_id");

-- CreateIndex
CREATE INDEX "assets_tenant_id_asset_family_idx" ON "assets"("tenant_id", "asset_family");

-- CreateIndex
CREATE INDEX "assets_tenant_id_serial_number_idx" ON "assets"("tenant_id", "serial_number");

-- CreateIndex
CREATE UNIQUE INDEX "assets_tenant_id_id_key" ON "assets"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "assets_tenant_id_asset_code_key" ON "assets"("tenant_id", "asset_code");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_object_key_key" ON "attachments"("object_key");

-- CreateIndex
CREATE INDEX "attachments_tenant_id_owner_type_owner_id_idx" ON "attachments"("tenant_id", "owner_type", "owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_tenant_id_id_key" ON "attachments"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "asset_documents_tenant_id_asset_id_idx" ON "asset_documents"("tenant_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "asset_documents_tenant_id_id_key" ON "asset_documents"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "service_contracts_tenant_id_status_end_date_idx" ON "service_contracts"("tenant_id", "status", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "service_contracts_tenant_id_id_key" ON "service_contracts"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "service_contracts_tenant_id_contract_no_key" ON "service_contracts"("tenant_id", "contract_no");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_plans_tenant_id_id_key" ON "maintenance_plans"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_plans_tenant_id_plan_code_key" ON "maintenance_plans"("tenant_id", "plan_code");

-- CreateIndex
CREATE UNIQUE INDEX "planned_visits_generation_key_key" ON "planned_visits"("generation_key");

-- CreateIndex
CREATE INDEX "planned_visits_tenant_id_status_due_at_idx" ON "planned_visits"("tenant_id", "status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "planned_visits_tenant_id_id_key" ON "planned_visits"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "planned_visits_tenant_id_work_order_id_key" ON "planned_visits"("tenant_id", "work_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_requests_request_no_key" ON "service_requests"("request_no");

-- CreateIndex
CREATE INDEX "service_requests_tenant_id_status_created_at_idx" ON "service_requests"("tenant_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "service_requests_tenant_id_customer_id_idx" ON "service_requests"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "service_requests_tenant_id_asset_id_idx" ON "service_requests"("tenant_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_requests_tenant_id_id_key" ON "service_requests"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_work_order_no_key" ON "work_orders"("work_order_no");

-- CreateIndex
CREATE INDEX "work_orders_tenant_id_status_created_at_idx" ON "work_orders"("tenant_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "work_orders_tenant_id_resolution_due_at_idx" ON "work_orders"("tenant_id", "resolution_due_at");

-- CreateIndex
CREATE INDEX "work_orders_tenant_id_customer_id_idx" ON "work_orders"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "work_orders_tenant_id_site_id_idx" ON "work_orders"("tenant_id", "site_id");

-- CreateIndex
CREATE INDEX "work_orders_tenant_id_asset_id_idx" ON "work_orders"("tenant_id", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_tenant_id_id_key" ON "work_orders"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "work_order_assignments_tenant_id_user_id_status_idx" ON "work_order_assignments"("tenant_id", "user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "work_order_assignments_tenant_id_work_order_id_user_id_key" ON "work_order_assignments"("tenant_id", "work_order_id", "user_id");

-- CreateIndex
CREATE INDEX "work_order_events_tenant_id_work_order_id_occurred_at_idx" ON "work_order_events"("tenant_id", "work_order_id", "occurred_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "work_order_events_tenant_id_id_key" ON "work_order_events"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_templates_tenant_id_id_key" ON "checklist_templates"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_templates_tenant_id_template_key_key" ON "checklist_templates"("tenant_id", "template_key");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_template_versions_tenant_id_id_key" ON "checklist_template_versions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_template_versions_tenant_id_template_id_version_key" ON "checklist_template_versions"("tenant_id", "template_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "work_order_checklist_results_tenant_id_work_order_id_templa_key" ON "work_order_checklist_results"("tenant_id", "work_order_id", "template_version_id", "item_key");

-- CreateIndex
CREATE INDEX "service_measurements_tenant_id_work_order_id_idx" ON "service_measurements"("tenant_id", "work_order_id");

-- CreateIndex
CREATE INDEX "service_measurements_tenant_id_asset_id_server_received_at_idx" ON "service_measurements"("tenant_id", "asset_id", "server_received_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "service_measurements_tenant_id_id_key" ON "service_measurements"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "service_observations_tenant_id_work_order_id_idx" ON "service_observations"("tenant_id", "work_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_observations_tenant_id_id_key" ON "service_observations"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "parts_usage_tenant_id_work_order_id_idx" ON "parts_usage"("tenant_id", "work_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "parts_usage_tenant_id_id_key" ON "parts_usage"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "service_reports_tenant_id_status_idx" ON "service_reports"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "service_reports_tenant_id_work_order_id_report_version_key" ON "service_reports"("tenant_id", "work_order_id", "report_version");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_user_id_read_at_idx" ON "notifications"("tenant_id", "user_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_tenant_id_id_key" ON "notifications"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "notification_deliveries_tenant_id_notification_id_idx" ON "notification_deliveries"("tenant_id", "notification_id");

-- CreateIndex
CREATE INDEX "audit_events_tenant_id_resource_type_resource_id_occurred_a_idx" ON "audit_events"("tenant_id", "resource_type", "resource_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_events_tenant_id_actor_user_id_occurred_at_idx" ON "audit_events"("tenant_id", "actor_user_id", "occurred_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "audit_events_tenant_id_id_key" ON "audit_events"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "outbox_events_published_at_created_at_idx" ON "outbox_events"("published_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_tenant_id_id_key" ON "outbox_events"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "mobile_sync_operations_tenant_id_user_id_idx" ON "mobile_sync_operations"("tenant_id", "user_id");

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "number_sequences" ADD CONSTRAINT "number_sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customer_accounts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customer_accounts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_tenant_id_parent_asset_id_fkey" FOREIGN KEY ("tenant_id", "parent_asset_id") REFERENCES "assets"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_documents" ADD CONSTRAINT "asset_documents_tenant_id_asset_id_fkey" FOREIGN KEY ("tenant_id", "asset_id") REFERENCES "assets"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_documents" ADD CONSTRAINT "asset_documents_tenant_id_attachment_id_fkey" FOREIGN KEY ("tenant_id", "attachment_id") REFERENCES "attachments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_contracts" ADD CONSTRAINT "service_contracts_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customer_accounts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_assets" ADD CONSTRAINT "contract_assets_tenant_id_contract_id_fkey" FOREIGN KEY ("tenant_id", "contract_id") REFERENCES "service_contracts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_assets" ADD CONSTRAINT "contract_assets_tenant_id_asset_id_fkey" FOREIGN KEY ("tenant_id", "asset_id") REFERENCES "assets"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_tenant_id_contract_id_fkey" FOREIGN KEY ("tenant_id", "contract_id") REFERENCES "service_contracts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_tenant_id_checklist_template_id_fkey" FOREIGN KEY ("tenant_id", "checklist_template_id") REFERENCES "checklist_templates"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plan_assets" ADD CONSTRAINT "maintenance_plan_assets_tenant_id_plan_id_fkey" FOREIGN KEY ("tenant_id", "plan_id") REFERENCES "maintenance_plans"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plan_assets" ADD CONSTRAINT "maintenance_plan_assets_tenant_id_asset_id_fkey" FOREIGN KEY ("tenant_id", "asset_id") REFERENCES "assets"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_visits" ADD CONSTRAINT "planned_visits_tenant_id_plan_id_fkey" FOREIGN KEY ("tenant_id", "plan_id") REFERENCES "maintenance_plans"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_visits" ADD CONSTRAINT "planned_visits_tenant_id_asset_id_fkey" FOREIGN KEY ("tenant_id", "asset_id") REFERENCES "assets"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_visits" ADD CONSTRAINT "planned_visits_tenant_id_work_order_id_fkey" FOREIGN KEY ("tenant_id", "work_order_id") REFERENCES "work_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customer_accounts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_tenant_id_asset_id_fkey" FOREIGN KEY ("tenant_id", "asset_id") REFERENCES "assets"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_tenant_id_request_id_fkey" FOREIGN KEY ("tenant_id", "request_id") REFERENCES "service_requests"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customer_accounts"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_tenant_id_site_id_fkey" FOREIGN KEY ("tenant_id", "site_id") REFERENCES "sites"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_tenant_id_asset_id_fkey" FOREIGN KEY ("tenant_id", "asset_id") REFERENCES "assets"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_tenant_id_checklist_template_version_id_fkey" FOREIGN KEY ("tenant_id", "checklist_template_version_id") REFERENCES "checklist_template_versions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignments_tenant_id_work_order_id_fkey" FOREIGN KEY ("tenant_id", "work_order_id") REFERENCES "work_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_assignments" ADD CONSTRAINT "work_order_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_tenant_id_work_order_id_fkey" FOREIGN KEY ("tenant_id", "work_order_id") REFERENCES "work_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_template_versions" ADD CONSTRAINT "checklist_template_versions_tenant_id_template_id_fkey" FOREIGN KEY ("tenant_id", "template_id") REFERENCES "checklist_templates"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_checklist_results" ADD CONSTRAINT "work_order_checklist_results_tenant_id_work_order_id_fkey" FOREIGN KEY ("tenant_id", "work_order_id") REFERENCES "work_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_checklist_results" ADD CONSTRAINT "work_order_checklist_results_tenant_id_template_version_id_fkey" FOREIGN KEY ("tenant_id", "template_version_id") REFERENCES "checklist_template_versions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_measurements" ADD CONSTRAINT "service_measurements_tenant_id_work_order_id_fkey" FOREIGN KEY ("tenant_id", "work_order_id") REFERENCES "work_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_measurements" ADD CONSTRAINT "service_measurements_tenant_id_asset_id_fkey" FOREIGN KEY ("tenant_id", "asset_id") REFERENCES "assets"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_observations" ADD CONSTRAINT "service_observations_tenant_id_work_order_id_fkey" FOREIGN KEY ("tenant_id", "work_order_id") REFERENCES "work_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parts_usage" ADD CONSTRAINT "parts_usage_tenant_id_work_order_id_fkey" FOREIGN KEY ("tenant_id", "work_order_id") REFERENCES "work_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_reports" ADD CONSTRAINT "service_reports_tenant_id_work_order_id_fkey" FOREIGN KEY ("tenant_id", "work_order_id") REFERENCES "work_orders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_reports" ADD CONSTRAINT "service_reports_tenant_id_generated_attachment_id_fkey" FOREIGN KEY ("tenant_id", "generated_attachment_id") REFERENCES "attachments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_reports" ADD CONSTRAINT "service_reports_tenant_id_signature_attachment_id_fkey" FOREIGN KEY ("tenant_id", "signature_attachment_id") REFERENCES "attachments"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_tenant_id_notification_id_fkey" FOREIGN KEY ("tenant_id", "notification_id") REFERENCES "notifications"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
