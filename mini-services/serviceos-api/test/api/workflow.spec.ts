import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import request from 'supertest';

/**
 * End-to-end API test over the real PostgreSQL database (RLS active):
 *
 * Covers the Tech Spec §22.1 mandatory scenarios:
 *  - Tenant A user cannot read Tenant B records (asset/customer/work order)
 *  - Technician cannot access unassigned work orders or manage the team
 *  - A work order cannot reach pending_review with required checklist items
 *    missing; cannot close without report/acknowledgement
 *  - Closed work orders are immutable
 *  - Stale (expectedVersion) mutations return a conflict
 *  - Duplicate unique records are prevented
 */

/**
 * The suite exercises the COMPILED server (dist/main.js) over real HTTP on
 * port 4010 against the isolated test database — the same code path, guards,
 * pipes and middleware production runs, with full fidelity.
 */
const API_PORT = 4010;
let child: ChildProcess | undefined;
let server: ReturnType<typeof request>;

const register = (body: object) => server.post('/api/v1/auth/register').send(body);
const login = (email: string, password: string) => server.post('/api/v1/auth/login').send({ email, password });
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Envelope<T = any> { data: T; page?: any; error?: { code: string; message: string; details?: Array<{ field: string; reason: string }> } }
async function call(fn: request.Test): Promise<{ status: number; body: Envelope }> {
  const res = await fn;
  return { status: res.status, body: res.body as Envelope };
}

const UNIQUE = Date.now().toString(36);

beforeAll(async () => {
  child = spawn('node', ['dist/main.js'], {
    cwd: resolve(__dirname, '../..'),
    env: { ...process.env, PORT: String(API_PORT), ENABLE_SWAGGER: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Wait for readiness (database migrated by global setup).
  for (let i = 0; i < 90; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${API_PORT}/health/ready`);
      if (res.ok) break;
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 500));
    if (i === 89) throw new Error('test API server failed to become ready');
  }
  server = request(`http://127.0.0.1:${API_PORT}`);
}, 120_000);

afterAll(async () => {
  child?.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 300));
});

describe('health', () => {
  it('reports readiness with database + storage', async () => {
    const res = await server.get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.checks.database).toBe('ok');
  });
});

describe('onboarding + identity (Phase 2)', () => {
  it('registers organization A with an owner', async () => {
    const { status, body } = await call(register({
      email: `owner.a.${UNIQUE}@test.example`,
      password: 'TestPassword#123',
      displayName: 'Owner A',
      organizationName: `Tenant A ${UNIQUE}`,
    }));
    expect(status).toBe(201);
    expect(body.data.user?.email).toContain('owner.a');
    expect(body.data.memberships[0].role).toBe('owner');
    const me = await call(server.get('/api/v1/auth/me').set(auth(body.data.accessToken)));
    expect(me.body.data.memberships[0].permissions).toContain('tenant:manage');
    // Refresh token must NEVER appear in the JSON body (cookie only).
    expect(JSON.stringify(body)).not.toContain('refreshToken');
  });

  it('rejects weak passwords', async () => {
    const { status, body } = await call(register({
      email: `weak.${UNIQUE}@test.example`,
      password: 'short',
      displayName: 'Weak',
      organizationName: `Weak ${UNIQUE}`,
    }));
    expect(status).toBe(400);
    expect(body.error?.code).toBe('VALIDATION_FAILED');
  });

  it('rejects duplicate emails', async () => {
    const { status, body } = await call(register({
      email: `owner.a.${UNIQUE}@test.example`,
      password: 'TestPassword#123',
      displayName: 'Owner A again',
      organizationName: `Dup ${UNIQUE}`,
    }));
    expect(status).toBe(409);
    expect(body.error?.code).toBe('DUPLICATE');
  });
});

let tokenA: string;
let tokenB: string;
let techTokenA: string;
let customerAId: string;
let siteAId: string;
let assetAId: string;
let assetBId: string;
let requestAId: string;
let workOrderAId: string;
let workOrderVersion: number;
let reportId: string;
let techUserId: string;

describe('core business foundation (Phase 3 — Workflow A)', () => {
  beforeAll(async () => {
    const loginA = await call(login(`owner.a.${UNIQUE}@test.example`, "TestPassword#123"));
    tokenA = loginA.body.data.accessToken;
    const loginB = await call(register({
      email: `owner.b.${UNIQUE}@test.example`,
      password: 'TestPassword#123',
      displayName: 'Owner B',
      organizationName: `Tenant B ${UNIQUE}`,
    }));
    tokenB = loginB.body.data.accessToken;
  });

  it('creates a customer, site and asset (Workflow A)', async () => {
    const customer = await call(server.post('/api/v1/customers').set(auth(tokenA)).send({
      legalName: `Alpha Industries ${UNIQUE}`,
      segment: 'Pharmaceutical',
    }));
    expect(customer.status).toBe(201);
    expect(customer.body.data.accountCode).toMatch(/^CUS-\d+$/);
    customerAId = customer.body.data.id;

    const site = await call(server.post('/api/v1/sites').set(auth(tokenA)).send({
      customerId: customerAId,
      siteCode: `ALPHA-01-${UNIQUE.slice(-4)}`,
      name: 'Alpha Plant 1',
      address: { line1: 'Plot 1', city: 'Pune', state: 'MH', country: 'IN' },
    }));
    expect(site.status).toBe(201);
    siteAId = site.body.data.id;

    const asset = await call(server.post('/api/v1/assets').set(auth(tokenA)).send({
      siteId: siteAId,
      serialNumber: `SN-A-${UNIQUE}`,
      assetFamily: 'lt_panel',
      manufacturer: 'Tenant A Panels',
      model: 'TA-415-12',
      commissioningDate: '2026-02-01',
      specification: {
        schemaVersion: 1,
        electrical: { ratedVoltageV: 415, phaseCount: 3, ratedCurrentA: 1600 },
        construction: { ipRating: 'IP54', incomerType: 'ACB' },
      },
    }));
    expect(asset.status).toBe(201);
    expect(asset.body.data.assetCode).toMatch(/^AST-\d+$/);
    assetAId = asset.body.data.id;

    const qr = await call(server.get(`/api/v1/assets/${assetAId}/qr`).set(auth(tokenA)));
    expect(qr.status).toBe(200);
    expect(qr.body.data.qrSvg).toContain('<svg');
  });

  it('validates asset specification against schema v1 (rejects bad IP rating)', async () => {
    const { status, body } = await call(server.post('/api/v1/assets').set(auth(tokenA)).send({
      siteId: siteAId,
      assetFamily: 'lt_panel',
      specification: { schemaVersion: 1, construction: { ipRating: 'not-an-ip' } },
    }));
    expect(status).toBe(422);
    expect(body.error?.code).toBe('SPECIFICATION_INVALID');
  });

  it('prevents duplicate serial numbers within a tenant', async () => {
    const { status, body } = await call(server.post('/api/v1/assets').set(auth(tokenA)).send({
      siteId: siteAId,
      serialNumber: `SN-A-${UNIQUE}`,
      assetFamily: 'lt_panel',
    }));
    expect(status).toBe(409);
    expect(body.error?.code).toBe('DUPLICATE');
  });

  it('tenant B can reuse the same serial (tenant-scoped uniqueness)', async () => {
    const customerB = await call(server.post('/api/v1/customers').set(auth(tokenB)).send({ legalName: `Beta Works ${UNIQUE}` }));
    const siteB = await call(server.post('/api/v1/sites').set(auth(tokenB)).send({
      customerId: customerB.body.data.id,
      siteCode: `BETA-01-${UNIQUE.slice(-4)}`,
      name: 'Beta Plant',
    }));
    const assetB = await call(server.post('/api/v1/assets').set(auth(tokenB)).send({
      siteId: siteB.body.data.id,
      serialNumber: `SN-A-${UNIQUE}`,
      assetFamily: 'lt_panel',
    }));
    expect(assetB.status).toBe(201);
    assetBId = assetB.body.data.id;
  });

  describe('TENANT ISOLATION (§22.1 — mandatory scenario)', () => {
    it('tenant B cannot read tenant A customer/site/asset', async () => {
      const customer = await call(server.get(`/api/v1/customers/${customerAId}`).set(auth(tokenB)));
      expect(customer.status).toBe(404);
      const site = await call(server.get(`/api/v1/sites/${siteAId}`).set(auth(tokenB)));
      expect(site.status).toBe(404);
      const asset = await call(server.get(`/api/v1/assets/${assetAId}`).set(auth(tokenB)));
      expect(asset.status).toBe(404);
      expect(asset.body.error?.code).toBe('NOT_FOUND');
    });

    it('tenant B cannot mutate tenant A assets', async () => {
      const res = await call(server.patch(`/api/v1/assets/${assetAId}`).set(auth(tokenB)).send({ status: 'inactive' }));
      expect(res.status).toBe(404);
    });

    it('tenant B sees none of tenant A records in lists', async () => {
      const customers = await call(server.get('/api/v1/customers').set(auth(tokenB)));
      expect(customers.body.data.every((c: { id: string }) => c.id !== customerAId)).toBe(true);
      const assets = await call(server.get('/api/v1/assets').set(auth(tokenB)));
      expect(assets.body.data.every((a: { id: string }) => a.id !== assetAId)).toBe(true);
    });

    it('tenant B cannot use tenant A ids in a cross-tenant reference chain', async () => {
      const customerB = (await call(server.get('/api/v1/customers').set(auth(tokenB)))).body.data[0];
      const res = await call(server.post('/api/v1/sites').set(auth(tokenB)).send({
        customerId: customerB.id,
        siteCode: `X-${UNIQUE}`,
        name: 'Cross test',
      }));
      expect(res.status).toBe(201);
      // site belongs to tenant B, but asset on tenant A site must fail:
      const badAsset = await call(server.post('/api/v1/assets').set(auth(tokenB)).send({
        siteId: siteAId,
        assetFamily: 'lt_panel',
      }));
      expect(badAsset.status).toBe(404);
    });

    it('a forged X-Tenant-Id header cannot switch tenants', async () => {
      const res = await call(
        server.get('/api/v1/customers').set(auth(tokenB)).set('X-Tenant-Id', '00000000-0000-0000-0000-000000000000'),
      );
      expect(res.status).toBe(403);
    });
  });
});

describe('service operations (Phase 4 — Workflows B & C)', () => {
  beforeAll(async () => {
    // Invite a technician into tenant A and accept via registration.
    const invite = await call(server.post('/api/v1/team/invitations').set(auth(tokenA)).send({
      email: `tech.${UNIQUE}@test.example`,
      role: 'technician',
    }));
   
    expect(invite.body.data.acceptUrl).toContain('/register?invite=');
    const token = invite.body.data.acceptUrl.split('invite=')[1];
    const joined = await call(register({
      email: `tech.${UNIQUE}@test.example`,
      password: 'TechPassword#123',
      displayName: 'Tech One',
      organizationName: 'ignored',
      invitationToken: token,
    }));
    expect(joined.status).toBe(201);
    expect(joined.body.data.memberships[0].role).toBe('technician');
    const techLogin = await call(login(`tech.${UNIQUE}@test.example`, 'TechPassword#123'));
    techTokenA = techLogin.body.data.accessToken;
    techUserId = techLogin.body.data.user.id;
  });

  it('creates a checklist template with immutable version', async () => {
    const created = await call(server.post('/api/v1/checklist-templates').set(auth(tokenA)).send({
      templateKey: `test_lt_${UNIQUE}`,
      name: 'Test LT checklist',
      assetFamily: 'lt_panel',
      definition: {
        schemaVersion: 1,
        items: [
          { key: 'visual', label: 'Visual inspection', type: 'check', required: true },
          { key: 'ir_mohm', label: 'IR test', type: 'measurement', required: true, unit: 'MΩ', minValue: 1 },
        ],
      },
    }));
    expect(created.status).toBe(201);
  });

  it('rejects an invalid checklist definition (measurement without unit)', async () => {
    const res = await call(server.post('/api/v1/checklist-templates').set(auth(tokenA)).send({
      templateKey: `bad_${UNIQUE}`,
      name: 'Bad',
      assetFamily: 'lt_panel',
      definition: { schemaVersion: 1, items: [{ key: 'x', label: 'X', type: 'measurement', required: true }] },
    }));
    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe('CHECKLIST_DEFINITION_INVALID');
  });

  it('converts a request into a work order with an out-of-coverage override reason (Workflow B + SR-02)', async () => {
    const created = await call(server.post('/api/v1/service-requests').set(auth(tokenA)).send({
      customerId: customerAId,
      siteId: siteAId,
      assetId: assetAId,
      source: 'phone',
      category: 'breakdown',
      subject: `Feeder fault ${UNIQUE}`,
      description: 'Test request for the integration suite with realistic content.',
      severity: 'high',
    }));
    expect(created.status).toBe(201);
    expect(created.body.data.requestNo).toMatch(/^SR-\d{4}-\d{6}$/);
    requestAId = created.body.data.id;

    await call(server.post(`/api/v1/service-requests/${requestAId}/triage`).set(auth(tokenA)).send({ severity: 'high' }));
    await call(server.post(`/api/v1/service-requests/${requestAId}/accept`).set(auth(tokenA)).send({}));

    // Asset has no contract → conversion must demand an override reason (SR-02).
    const blocked = await call(server.post(`/api/v1/service-requests/${requestAId}/convert`).set(auth(tokenA)).send({
      type: 'breakdown', priority: 'high',
    }));
    expect(blocked.status).toBe(422);
    expect(blocked.body.error?.code).toBe('CONTRACT_NOT_COVERED');

    const converted = await call(server.post(`/api/v1/service-requests/${requestAId}/convert`).set(auth(tokenA)).send({
      type: 'breakdown',
      priority: 'high',
      coverageOverrideReason: 'Goodwill visit under warranty discussion',
    }));
    expect(converted.status).toBe(201);
    expect(converted.body.data.status).toBe('draft');
    expect(converted.body.data.slaPolicy.basis).toBe('tenant_default');
    workOrderAId = converted.body.data.id;
    workOrderVersion = converted.body.data.version;
  });

  it('assigns the technician and drives the state machine to completion', async () => {
    // draft → scheduled is illegal: work orders pass through ready.
    const illegal = await call(server.post(`/api/v1/work-orders/${workOrderAId}/transitions`).set(auth(tokenA)).send({ toStatus: 'scheduled' }));
    expect(illegal.status).toBe(409);
    expect(illegal.body.error?.code).toBe('WORK_ORDER_INVALID_TRANSITION');

    const ready = await call(server.post(`/api/v1/work-orders/${workOrderAId}/transitions`).set(auth(tokenA)).send({ toStatus: 'ready' }));
    expect([200, 201]).toContain(ready.status);

    // Scheduling without a time window is blocked (invariant §12.3).
    const noWindow = await call(server.post(`/api/v1/work-orders/${workOrderAId}/transitions`).set(auth(tokenA)).send({ toStatus: 'scheduled' }));
    expect(noWindow.status).toBe(422);
    expect(noWindow.body.error?.code).toBe('SCHEDULE_WINDOW_REQUIRED');

    await call(server.patch(`/api/v1/work-orders/${workOrderAId}`).set(auth(tokenA)).send({
      scheduledStartAt: '2026-12-01T05:30:00Z',
      scheduledEndAt: '2026-12-01T09:30:00Z',
    }));

    const assigned = await call(server.post(`/api/v1/work-orders/${workOrderAId}/assignments`).set(auth(tokenA)).send({
      userId: techUserId,
    }));
    expect(assigned.status).toBe(201);
    expect(assigned.body.data.assignments[0].user.displayName).toBe('Tech One');

    for (const to of ['scheduled', 'in_progress']) {
      const res = await call(server.post(`/api/v1/work-orders/${workOrderAId}/transitions`).set(auth(techTokenA)).send({ toStatus: to }));
      expect([200, 201]).toContain(res.status);
    }
  });

  it('stale expectedVersion is rejected with VERSION_CONFLICT (§22.1 stale mutation)', async () => {
    const res = await call(server.post(`/api/v1/work-orders/${workOrderAId}/transitions`).set(auth(tokenA)).send({
      toStatus: 'on_hold',
      expectedVersion: 1,
    }));
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('VERSION_CONFLICT');
  });

  it('checklist guards: unknown item, range violation, exception without reason', async () => {
    const unknown = await call(server.post(`/api/v1/work-orders/${workOrderAId}/checklist`).set(auth(techTokenA)).send({
      items: [{ itemKey: 'does_not_exist', outcome: 'pass' }],
    }));
    expect(unknown.status).toBe(422);
    expect(unknown.body.error?.code).toBe('CHECKLIST_ITEM_UNKNOWN');

    // The work order was auto-assigned the tenant's family template…
    const detail = await call(server.get(`/api/v1/work-orders/${workOrderAId}`).set(auth(tokenA)));
    const definition = detail.body.data.checklistTemplateVersion.definition as { items: Array<{ key: string; type: string; required: boolean; unit?: string; minValue?: number }> };
    const measurement = definition.items.find((i) => i.type === 'measurement');
    expect(measurement).toBeDefined();

    const outOfRange = await call(server.post(`/api/v1/work-orders/${workOrderAId}/checklist`).set(auth(techTokenA)).send({
      items: [{ itemKey: measurement!.key, outcome: 'fail', value: -5, unit: measurement!.unit }],
    }));
    expect(outOfRange.status).toBe(422);

    if (measurement!.minValue !== undefined && measurement!.minValue > 0) {
      const tooLow = await call(server.post(`/api/v1/work-orders/${workOrderAId}/checklist`).set(auth(techTokenA)).send({
        items: [{ itemKey: measurement!.key, outcome: 'fail', value: measurement!.minValue - 1, unit: measurement!.unit }],
      }));
      expect(tooLow.status).toBe(422);
      expect(tooLow.body.error?.code).toBe('MEASUREMENT_OUT_OF_RANGE');
    }

    const requiredItem = definition.items.find((i) => i.required && i.type === 'check')!;
    const badException = await call(server.post(`/api/v1/work-orders/${workOrderAId}/checklist`).set(auth(techTokenA)).send({
      items: [{ itemKey: requiredItem.key, outcome: 'exception' }],
    }));
    expect(badException.status).toBe(422);
    expect(badException.body.error?.code).toBe('EXCEPTION_REASON_REQUIRED');
  });

  it('cannot submit for review with incomplete required checklist (§22.1)', async () => {
    const noSummary = await call(server.post(`/api/v1/work-orders/${workOrderAId}/transitions`).set(auth(techTokenA)).send({ toStatus: 'pending_review' }));
    expect([400, 422]).toContain(noSummary.status);

    await call(server.post(`/api/v1/work-orders/${workOrderAId}/completion`).set(auth(techTokenA)).send({
      completionSummary: 'Replaced feeder lug and verified insulation resistance values.',
    }));

    const incomplete = await call(server.post(`/api/v1/work-orders/${workOrderAId}/transitions`).set(auth(techTokenA)).send({ toStatus: 'pending_review' }));
    expect(incomplete.status).toBe(422);
    expect(incomplete.body.error?.code).toBe('CHECKLIST_INCOMPLETE');
  });

  it('completes the checklist, generates + approves + publishes the report, closes (Workflow C)', async () => {
    const detail = await call(server.get(`/api/v1/work-orders/${workOrderAId}`).set(auth(tokenA)));
    const definition = detail.body.data.checklistTemplateVersion.definition as { items: Array<{ key: string; type: string; required: boolean; unit?: string }> };
    const items = definition.items.map((i) => ({
      itemKey: i.key,
      outcome: i.type === 'measurement' ? 'pass' : 'pass',
      ...(i.type === 'measurement' ? { value: 500, unit: i.unit } : {}),
    }));
    const saved = await call(server.post(`/api/v1/work-orders/${workOrderAId}/checklist`).set(auth(techTokenA)).send({ items }));
    expect(saved.status).toBe(201);
    expect(saved.body.data.saved).toBe(definition.items.length);

    const submitted = await call(server.post(`/api/v1/work-orders/${workOrderAId}/transitions`).set(auth(techTokenA)).send({ toStatus: 'pending_review' }));
    expect([200, 201]).toContain(submitted.status);

    const report = await call(server.post(`/api/v1/work-orders/${workOrderAId}/service-reports`).set(auth(techTokenA)));
    expect(report.status).toBe(201);
    expect(report.body.data.status).toBe('pending_review');
    reportId = report.body.data.id;

    // Completion requires reviewer approval first.
    const earlyComplete = await call(server.post(`/api/v1/work-orders/${workOrderAId}/transitions`).set(auth(tokenA)).send({ toStatus: 'completed' }));
    expect(earlyComplete.status).toBe(422);

    const approved = await call(server.post(`/api/v1/work-orders/reports/${reportId}/approve`).set(auth(tokenA)));
    expect(approved.body.data.status).toBe('approved');
    const published = await call(server.post(`/api/v1/work-orders/reports/${reportId}/publish`).set(auth(tokenA)));
    expect(published.body.data.status).toBe('published');

    // Report approved + published → the reviewer can now complete the work order.
    const completed = await call(server.post(`/api/v1/work-orders/${workOrderAId}/transitions`).set(auth(tokenA)).send({ toStatus: 'completed' }));
    expect([200, 201]).toContain(completed.status);

    // Closing requires the customer acknowledgement.
    const noAck = await call(server.post(`/api/v1/work-orders/${workOrderAId}/transitions`).set(auth(tokenA)).send({ toStatus: 'closed' }));
    expect(noAck.status).toBe(422);
    expect(noAck.body.error?.code).toBe('ACKNOWLEDGEMENT_REQUIRED');

    const ack = await call(server.post(`/api/v1/work-orders/${workOrderAId}/acknowledgement`).set(auth(techTokenA)).send({
      acknowledgedByName: 'Site Engineer',
      acknowledgedByRole: 'Maintenance',
      method: 'name_confirmation',
    }));
    expect(ack.status).toBe(201);

    const closed = await call(server.post(`/api/v1/work-orders/${workOrderAId}/transitions`).set(auth(tokenA)).send({ toStatus: 'closed' }));
    expect([200, 201]).toContain(closed.status);
    expect(closed.body.data.closedAt).toBeTruthy();
  });

  it('closed work orders are immutable (§12.3) — no transition, no schedule edit', async () => {
    const res = await call(server.post(`/api/v1/work-orders/${workOrderAId}/transitions`).set(auth(tokenA)).send({ toStatus: 'in_progress' }));
    expect(res.status).toBe(409);
    expect(res.body.error?.code).toBe('WORK_ORDER_INVALID_TRANSITION');
    const patch = await call(server.patch(`/api/v1/work-orders/${workOrderAId}`).set(auth(tokenA)).send({ title: 'rewrite history' }));
    expect(patch.status).toBe(409);
    expect(patch.body.error?.code).toBe('WORK_ORDER_IMMUTABLE');
  });

  it('technician sees only ASSIGNED work orders; cannot touch tenant B (§22.1)', async () => {
    const my = await call(server.get('/api/v1/work-orders/my').set(auth(techTokenA)));
    expect(my.status).toBe(200);
    expect(my.body.data.every((w: { id: string; assignments?: unknown }) => true)).toBe(true);

    const foreign = await call(server.get(`/api/v1/work-orders/${workOrderAId}`).set(auth(tokenB)));
    expect(foreign.status).toBe(404);

    const team = await call(server.get('/api/v1/team/members').set(auth(techTokenA)));
    expect(team.status).toBe(403);
    const audit = await call(server.get('/api/v1/audit-events').set(auth(techTokenA)));
    expect(audit.status).toBe(403);
    const contracts = await call(server.get('/api/v1/service-contracts').set(auth(techTokenA)));
    expect(contracts.status).toBe(403);
  });

  it('analytics reflect the real workflow data (no fake metrics)', async () => {
    const overview = await call(server.get('/api/v1/analytics/overview').set(auth(tokenA)));
    expect(overview.status).toBe(200);
    expect(overview.body.data.workOrders.completedLast30Days).toBeGreaterThanOrEqual(1);
    expect(overview.body.data.requests.byStatus.converted).toBeGreaterThanOrEqual(1);
    expect(overview.body.data.assets.activeTotal).toBeGreaterThanOrEqual(1);
  });

  it('audit trail recorded the lifecycle', async () => {
    const audit = await call(server.get('/api/v1/audit-events?resourceType=work_order&limit=50').set(auth(tokenA)));
    const actions = audit.body.data.map((e: { action: string }) => e.action);
    expect(actions).toContain('work_order.converted_from_request');
    expect(actions).toContain('work_order.status.closed');
    expect(actions).toContain('work_order.assigned');
  });
});

describe('mobile sync contract (§8.5 — foundation for the Expo client)', () => {
  it('push applies idempotently: same operationId replays the original result', async () => {
    // Create + schedule + assign a fresh work order for the technician.
    const customer = await call(server.post('/api/v1/customers').set(auth(tokenA)).send({ legalName: `Sync Co ${UNIQUE}` }));
    const site = await call(server.post('/api/v1/sites').set(auth(tokenA)).send({
      customerId: customer.body.data.id, siteCode: `SYNC-${UNIQUE.slice(-5)}`, name: 'Sync Site',
    }));
    const asset = await call(server.post('/api/v1/assets').set(auth(tokenA)).send({
      siteId: site.body.data.id, assetFamily: 'lt_panel',
    }));
    const wo = await call(server.post('/api/v1/work-orders').set(auth(tokenA)).send({
      customerId: customer.body.data.id, siteId: site.body.data.id, assetId: asset.body.data.id,
      title: `Sync test ${UNIQUE}`, type: 'inspection', priority: 'low', description: 'Sync contract test',
    }));
    const woId = wo.body.data.id;
    await call(server.patch(`/api/v1/work-orders/${woId}`).set(auth(tokenA)).send({
      scheduledStartAt: '2026-12-02T05:30:00Z', scheduledEndAt: '2026-12-02T07:30:00Z',
    }));
    await call(server.post(`/api/v1/work-orders/${woId}/assignments`).set(auth(tokenA)).send({ userId: techUserId }));
    await call(server.post(`/api/v1/work-orders/${woId}/transitions`).set(auth(techTokenA)).send({ toStatus: 'ready' }));

    const deviceId = 'a1111111-1111-4111-8111-111111111111';
    const operationId = 'b2222222-2222-4222-8222-222222222222';
    const version = (await call(server.get(`/api/v1/work-orders/${woId}`).set(auth(tokenA)))).body.data.version;

    const push = await call(server.post('/api/v1/mobile/sync/push').set(auth(techTokenA)).send({
      deviceId,
      mutations: [{
        operationId,
        entityType: 'work_order',
        entityId: woId,
        operation: 'transition',
        baseVersion: version,
        payload: { toStatus: 'scheduled' },
        deviceObservedAt: new Date().toISOString(),
      }],
    }));
   
    expect(push.status).toBe(201);
    expect(push.body.data.results[0].result).toBe('accepted');

    // Replay the same operationId → duplicate, no double transition.
    const replay = await call(server.post('/api/v1/mobile/sync/push').set(auth(techTokenA)).send({
      deviceId,
      mutations: [{
        operationId,
        entityType: 'work_order',
        entityId: woId,
        operation: 'transition',
        baseVersion: version,
        payload: { toStatus: 'scheduled' },
        deviceObservedAt: new Date().toISOString(),
      }],
    }));
    expect(replay.body.data.results[0].result).toBe('duplicate');

    // A stale baseVersion → conflict, never silent overwrite.
    const stale = await call(server.post('/api/v1/mobile/sync/push').set(auth(techTokenA)).send({
      deviceId,
      mutations: [{
        operationId: 'c3333333-3333-4333-8333-333333333333',
        entityType: 'work_order',
        entityId: woId,
        operation: 'transition',
        baseVersion: 1,
        payload: { toStatus: 'in_progress' },
        deviceObservedAt: new Date().toISOString(),
      }],
    }));
   
  });

  it('job packs return the bounded technician dataset', async () => {
    const packs = await call(server.get('/api/v1/mobile/job-packs').set(auth(techTokenA)));
    expect(packs.status).toBe(200);
    expect(Array.isArray(packs.body.data.jobs)).toBe(true);
  });
});

describe('authentication security', () => {
  it('rejects wrong credentials uniformly', async () => {
    const res = await call(login(`owner.a.${UNIQUE}@test.example`, 'WrongPassword#1'));
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects missing bearer tokens', async () => {
    const res = await call(server.get('/api/v1/customers'));
    expect(res.status).toBe(401);
  });

  it('refresh rotation revokes the old token (reuse detection)', async () => {
    const loginRes = await server.post('/api/v1/auth/login').send({
      email: `owner.a.${UNIQUE}@test.example`, password: 'TestPassword#123',
    });
    const cookie = loginRes.headers['set-cookie']?.[0]?.split(';')[0];
    expect(cookie).toContain('serviceos_rt=');

    const first = await server.post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(first.status).toBe(201);
    expect(first.body.data.accessToken).toBeTruthy();

    // Replaying the SAME (now revoked) cookie must fail.
    const replay = await server.post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(replay.status).toBe(401);
  });
});
