-- ServiceOS migration — tenant-scoped document numbers (found by audit
-- remediation test DATA-02/DATA-03 suites).
--
-- Bug: request_no / work_order_no are allocated from PER-TENANT sequences
-- (NumberingService: SR-2026-000001 per tenant) but were guarded by GLOBAL
-- unique indexes. Two tenants each creating their first request collided
-- with DUPLICATE — a multi-tenant correctness defect (Blueprint §12:
-- document numbers are tenant-scoped, like accountCode/siteCode/assetCode/
-- contractNo/planCode which are already composite-uniqued).
--
-- Fix: replace the global unique indexes with (tenant_id, request_no) and
-- (tenant_id, work_order_no) composite unique indexes.

DROP INDEX IF EXISTS service_requests_request_no_key;
CREATE UNIQUE INDEX service_requests_tenant_request_no_uq
  ON service_requests (tenant_id, request_no);

DROP INDEX IF EXISTS work_orders_work_order_no_key;
CREATE UNIQUE INDEX work_orders_tenant_work_order_no_uq
  ON work_orders (tenant_id, work_order_no);
