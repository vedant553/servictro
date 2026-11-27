# ServiceOS — Database Design

PostgreSQL 17 is the single system of record. Schema source:
`mini-services/serviceos-api/prisma/schema.prisma` + reviewed SQL migrations in
`prisma/migrations/`. Baseline: Tech Spec §11 + Appendix A DDL.

## Conventions

- Tables plural, `snake_case`; API JSON camelCase; enum values `lower_snake_case`.
- UUID primary keys (v4). Human-readable numbers (`SR-2026-000123`) via
  `number_sequences` allocated inside the creation transaction (ADR-016).
- Every tenant-owned row: `tenant_id NOT NULL`; composite FKs `(tenant_id, child_id)`
  → `(tenant_id, id)`; tenant-scoped unique constraints (serials are never globally
  unique — spec §11.1).
- `timestamptz` everywhere (UTC); IANA timezone per tenant/site; date-only terms
  (contract start/end) are `date`; money = `bigint` minor units + `char(3)` ISO-4217;
  measurements `numeric(18,4)` + explicit unit.
- `version INT` optimistic-concurrency column on editable aggregate roots; updates
  use `WHERE id = ? AND tenant_id = ? AND version = expected` → HTTP 409 on miss.
- Soft delete (`deleted_at`) only on mutable masters (customers, sites, contacts,
  contracts); transactional history (events, audit, reports) is append-only.
- JSONB only for versioned extension payloads validated at the API boundary
  (asset specification, checklist definitions, address); core filter/report
  dimensions stay relational columns (spec §11.1).

## Entity map (core)

```
tenants ─┬─ tenant_memberships ── users ── refresh_tokens
         ├─ invitations          (global tables; no RLS — platform scope)
         ├─ number_sequences
         └─ [RLS-protected tenant-owned tables below]
            customer_accounts ─ customer_contacts
                 └─ sites ─ assets ── asset_documents ── attachments
                            │  └─ contract_assets ── service_contracts
                            │        └─ maintenance_plans ─ maintenance_plan_assets
                            │                                   └─ planned_visits
                            ├─ service_requests ── work_orders
                            │       work_order_assignments / _events
                            │       checklist_template_versions (snapshot)
                            │       work_order_checklist_results
                            │       service_measurements / observations
                            │       parts_usage ── service_reports
                            ├─ notifications        ── audit_events
                            └─ outbox_events / idempotency_keys / mobile_sync_operations
```

## Key tables (summary)

| Table                | Purpose / notable columns |
| -------------------- | ------------------------- |
| `tenants`            | slug, name, timezone, locale, currency, status, plan, settings JSONB (numbering, SLA defaults, feature flags) |
| `users`              | email (lowercased, unique), display_name, password_hash, status, identity_issuer/subject (future OIDC) |
| `tenant_memberships` | PK (tenant, user), role_key, status, skills TEXT[] |
| `invitations`        | token_hash, email, role, expiry, status |
| `customer_accounts`  | account_code (tenant-unique), legal_name, segment, billing address JSONB, status |
| `customer_contacts`  | name, role, email, phone, is_primary, notes |
| `sites`              | site_code, name, address JSONB, lat/lng, timezone, access_instructions |
| `assets`             | asset_code (tenant-unique), serial_no, asset_family, manufacturer, model, commissioning_date, parent_asset_id (hierarchy), specification JSONB + schema version, status |
| `attachments`        | object_key (opaque, tenant-namespaced), original_name, content_type, size, sha256, scan_status, status |
| `asset_documents`    | document_type, revision, notes, attachment link |
| `service_contracts`  | contract_no, type (warranty/amc/service), status, start/end, currency, amount_minor, response/resolution targets, terms JSONB, renewal_status |
| `contract_assets`    | coverage_type, included_visits, notes |
| `service_requests`   | request_no, source, subject, description, severity, status, category, contact, preferred_visit_at, resolution outcome |
| `work_orders`        | work_order_no, request link, type, status, priority, scheduled window, SLA snapshot + due timestamps, checklist template version snapshot, version, closed_at |
| `work_order_assignments` | user, role (technician/lead), status (offered/accepted/rejected/active/completed) |
| `work_order_events`  | append-only state history (from/to status, actor, reason) |
| `checklist_templates` + `_versions` | immutable versioned definitions (JSONB items) |
| `work_order_checklist_results` | item_key, outcome pass/fail/na/exception, value+unit, note, performed_by |
| `service_measurements` | measurement_key, numeric value, unit, phase, instrument, device vs server timestamps |
| `service_observations`| append-only technician findings/actions |
| `parts_usage`        | part_code, description, qty+unit, serial/batch |
| `service_reports`    | version, status, template version, generated attachment, approver, publish, supersedes link, customer acknowledgement (name/role/method/signature attachment or non-sign reason) |
| `maintenance_plans`  | plan_code, asset family, recurrence JSONB, timezone, start/end, checklist template link, contract link, status |
| `maintenance_plan_assets` / `planned_visits` | plan membership; due_at, generation_key (tenant-unique → duplicate-proof), status, work_order link |
| `notifications`      | recipient, category, title, body, entity refs, read_at |
| `audit_events`       | actor, action, resource type/id, before/after metadata, request_id |
| `outbox_events`      | event_type, aggregate, payload, published_at, attempts, last_error |
| `idempotency_keys`   | PK (tenant, key), request_hash, response snapshot, expiry |
| `mobile_sync_operations` | operation_id dedupe + conflict results (ADR-008 future native client) |

## Row-Level Security

Applied by migration `XXXX_rls_policies_grants`:

```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <t> FORCE ROW LEVEL SECURITY;
CREATE POLICY <t>_tenant_isolation ON <t>
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

- API runtime connects as **`serviceos_app`** (non-owner, no BYPASSRLS); migrations
  run as the owner role. Grants + `ALTER DEFAULT PRIVILEGES` keep future tables
  covered.
- The application *always* opens an interactive Prisma transaction per tenant
  operation and sets `set_config('app.tenant_id', <uuid>, true)` first
  (transaction-local ⇒ no pooled-session leakage, spec §15.3 warning).
- Application-layer scoping + composite FKs remain the primary controls; RLS is
  defence-in-depth (spec §15.2). Verified by `test/rls.spec.ts`.

## Migrations & seeding

- `bunx prisma migrate dev --create-only --name <x>` then review/extend the SQL
  (CHECKs, partial indexes, RLS, grants) then apply. Immutable after apply.
- Seed (`prisma/seed.ts`): two fictional tenants + full demo dataset (ADR-015).
- Local lifecycle: `scripts/pg.sh start|stop|status` (embedded PG 17 on :5433).

## Indexing baseline (Tech Spec §25.1)

- `(tenant_id, status, created_at DESC)` on requests/work orders.
- `(tenant_id, customer_id)` / `(tenant_id, site_id)` on child resources.
- `(tenant_id, asset_id, created_at DESC)` for asset timeline.
- `(tenant_id, due_at)` partial `WHERE status NOT IN ('closed','cancelled')`.
- `outbox_events(created_at) WHERE published_at IS NULL`.
- Serial/name search: `pg_trgm` GIN index on customers.legal_name and
  assets.serial_number (added with the search feature after usage evidence).
