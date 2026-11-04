import request from 'supertest';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenantDbService } from '../../src/common/tenant/tenant-db.service';
import { OutboxService } from '../../src/common/outbox/outbox.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { RenewalRemindersService } from '../../src/modules/maintenance/renewal-reminders.service';
import { startApi, call } from './helpers';

/**
 * AMC renewal pass correctness (audit DATA-04 / DATA-05 / SEC-03):
 *
 *  1. Expiry detection on UTC-day boundaries: a contract ending TODAY is
 *     still covered; one that ended while the worker was down (any time in
 *     the past) is picked up, expired and announced.
 *  2. Horizon reminders (90/60/30 + expires-today) are deduplicated by a
 *     stable key — a second pass (worker restart, second instance) produces
 *     ZERO duplicate notifications.
 *  3. The outbox claim protocol runs under the least-privilege worker role.
 */

const API_PORT = 4013;
const UNIQUE = Date.now().toString(36);
const TEST_DB = 'postgresql://postgres:postgres@127.0.0.1:5433/serviceos_test';
const WORKER_DB = 'postgresql://serviceos_worker:serviceos_worker_dev@127.0.0.1:5433/serviceos_test';

describe('AMC renewal pass (DATA-04 / DATA-05)', () => {
  let server: ReturnType<typeof request>;
  let stop: () => Promise<void>;
  let renewal: RenewalRemindersService;
  let prismaForCleanup: PrismaService | undefined;
  let db: Client;
  let tenantId: string;
  let ownerUserId: string;

  // Controlled-dated contracts.
  const contractRows: Array<{ key: string; endDate: string; expect: 'expired' | 'today' | 'horizon30' | 'far' }> = [
    { key: 'past5', endDate: '2026-10-26', expect: 'expired' }, // expired 5 days ago (worker was "down")
    { key: 'today', endDate: '2026-11-01', expect: 'today' },
    { key: 'd30', endDate: '2026-12-01', expect: 'horizon30' },
    { key: 'far', endDate: '2027-06-30', expect: 'far' },
  ];
  const contractIds: Record<string, string> = {};

  beforeAll(async () => {
    // Boot the API so tenant RLS context/prisma services initialize against
    // the test database, then build the renewal service through plain DI
    // (constructor wiring identical to MaintenanceModule — avoids importing
    // @nestjs/testing, whose ESM packaging is unreliable under ts-jest).
    const harness = await startApi(API_PORT);
    server = harness.server;
    stop = harness.stop;

    const prisma = new PrismaService();
    await prisma.$connect();
    const tenantDb = new TenantDbService(prisma);
    const outbox = new OutboxService();
    const notifications = new NotificationsService(outbox);
    renewal = new RenewalRemindersService(tenantDb, notifications);
    prismaForCleanup = prisma;

    db = new Client({ connectionString: TEST_DB });
    await db.connect();

    // Bootstrap a tenant + owner directly (controlled endDate fixtures).
    const org = await call(server.post('/api/v1/auth/register').send({
      email: `owner.amc.${UNIQUE}@test.example`,
      password: 'TestPassword#123',
      displayName: 'AMC Owner',
      organizationName: `AMC Tenant ${UNIQUE}`,
    }));
    ownerUserId = org.body.data.user.id;
    const memberships = await db.query(
      'SELECT tenant_id FROM tenant_memberships WHERE user_id = $1 LIMIT 1',
      [ownerUserId],
    );
    tenantId = memberships.rows[0].tenant_id;

    // A real customer row to satisfy the contract FK.
    const customer = await db.query(
      `INSERT INTO customer_accounts (id, tenant_id, account_code, legal_name, status, segment, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'AMC Fixture Customer', 'active', 'Pharmaceutical', now(), now()) RETURNING id`,
      [tenantId, `AMC-CUST-${UNIQUE}`],
    );
    const customerId = customer.rows[0].id;

    for (const row of contractRows) {
      const inserted = await db.query(
        `INSERT INTO service_contracts (id, tenant_id, customer_id, contract_no, contract_type, status, start_date, end_date, renewal_status, version, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 'amc', 'active', '2025-11-01', $4, 'not_due', 1, now(), now()) RETURNING id`,
        [tenantId, customerId, `AMC-${row.key}-${UNIQUE}`, row.endDate],
      );
      contractIds[row.key] = inserted.rows[0].id;
    }
  }, 120_000);

  afterAll(async () => {
    await db.end();
    await prismaForCleanup?.$disconnect();
    await stop();
  });

  it('discovers long-expired contracts (no lower time bound)', async () => {
    // Discovery via the same shape the worker uses (poller client).
    const poller = new PrismaClient({ datasourceUrl: TEST_DB });
    const { where } = RenewalRemindersService.discoveryQuery(new Date('2026-11-01T14:00:00Z'));
    const rows = await poller.serviceContract.findMany({ where, select: { id: true, tenantId: true, contractNo: true, endDate: true, renewalStatus: true } });
    await poller.$disconnect();
    const ids = rows.map((r: { id: string }) => r.id);
    expect(ids).toContain(contractIds.past5); // expired 5 days ago — MUST be found
    expect(ids).toContain(contractIds.today);
    expect(ids).toContain(contractIds.d30);
    expect(ids).not.toContain(contractIds.far); // outside the 90-day horizon
  });

  it('marks expired contracts, flags due_soon and emits horizon reminders', async () => {
    const poller = new PrismaClient({ datasourceUrl: TEST_DB });
    const { where } = RenewalRemindersService.discoveryQuery(new Date('2026-11-01T14:00:00Z'));
    const rows = await poller.serviceContract.findMany({ where, select: { id: true, tenantId: true, contractNo: true, endDate: true, renewalStatus: true } });
    await poller.$disconnect();

    const result = await renewal.runPass(rows, new Date('2026-11-01T14:00:00Z'));
    expect(result.expired).toBe(1); // past5
    expect(result.dueSoon).toBeGreaterThanOrEqual(2); // today + d30 flip to due_soon
    expect(result.reminded).toBeGreaterThanOrEqual(2); // horizon notifications created

    // Contract status flips.
    const past5 = await db.query('SELECT status FROM service_contracts WHERE id = $1', [contractIds.past5]);
    expect(past5.rows[0].status).toBe('expired');
    const d30 = await db.query('SELECT renewal_status FROM service_contracts WHERE id = $1', [contractIds.d30]);
    expect(d30.rows[0].renewal_status).toBe('due_soon');
    const far = await db.query('SELECT status, renewal_status FROM service_contracts WHERE id = $1', [contractIds.far]);
    expect(far.rows[0].status).toBe('active');
    expect(far.rows[0].renewal_status).toBe('not_due');
  });

  it('a contract ending TODAY stays covered (entitlement semantics — DATA-04)', async () => {
    // runPass treats endDate=today as NOT expired (0 days remaining).
    const todayRow = await db.query('SELECT status FROM service_contracts WHERE id = $1', [contractIds.today]);
    expect(todayRow.rows[0].status).toBe('active');
  });

  it('re-running the pass creates ZERO duplicate notifications (dedup)', async () => {
    const before = await db.query(
      'SELECT count(*)::int AS n FROM notifications WHERE tenant_id = $1 AND category = $2',
      [tenantId, 'amc_renewal'],
    );
    expect(before.rows[0].n).toBeGreaterThan(0);

    // Second pass — same instant (worker restart scenario).
    const poller = new PrismaClient({ datasourceUrl: TEST_DB });
    const { where } = RenewalRemindersService.discoveryQuery(new Date('2026-11-01T14:00:00Z'));
    const rows = await poller.serviceContract.findMany({ where, select: { id: true, tenantId: true, contractNo: true, endDate: true, renewalStatus: true } });
    await poller.$disconnect();
    await renewal.runPass(rows, new Date('2026-11-01T15:30:00Z'));

    const after = await db.query(
      'SELECT count(*)::int AS n FROM notifications WHERE tenant_id = $1 AND category = $2',
      [tenantId, 'amc_renewal'],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);

    // Dedup keys are present and unique per user.
    const dedup = await db.query(
      "SELECT dedup_key, count(*)::int AS n FROM notifications WHERE tenant_id = $1 AND category = 'amc_renewal' GROUP BY dedup_key",
      [tenantId],
    );
    for (const row of dedup.rows) {
      expect(row.n).toBe(1);
      expect(row.dedup_key).toMatch(/^amc_renewal:/);
    }
  });
});

describe('worker least-privilege role + outbox claim (SEC-03 / DATA-06)', () => {
  let db: Client;

  beforeAll(async () => {
    db = new Client({ connectionString: WORKER_DB });
    await db.connect();
  });

  afterAll(async () => {
    await db.end();
  });

  it('can read outbox events across tenants (RLS policy grants it)', async () => {
    const res = await db.query('SELECT count(*)::int AS n FROM outbox_events');
    expect(typeof res.rows[0].n).toBe('number');
  });

  it('CANNOT read customer data (permission denied)', async () => {
    await expect(db.query('SELECT count(*) FROM customer_accounts')).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('CANNOT read users or refresh tokens (permission denied)', async () => {
    await expect(db.query('SELECT count(*) FROM users')).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('SELECT count(*) FROM refresh_tokens')).rejects.toMatchObject({ code: '42501' });
  });

  it('CANNOT insert or delete outbox events (claim + finalize only)', async () => {
    await expect(
      db.query("INSERT INTO outbox_events (tenant_id, event_type, aggregate_type, aggregate_id) VALUES (gen_random_uuid(), 'x', 'y', gen_random_uuid())"),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('DELETE FROM outbox_events WHERE true')).rejects.toMatchObject({ code: '42501' });
  });

  it('can execute the SKIP LOCKED claim statement atomically', async () => {
    // Seed an unpublished event as the owner role.
    const owner = new Client({ connectionString: TEST_DB });
    await owner.connect();
    const tenant = await owner.query('SELECT id FROM tenants LIMIT 1');
    const tenantId = tenant.rows[0].id;
    await owner.query(
      `INSERT INTO outbox_events (id, tenant_id, event_type, aggregate_type, aggregate_id, payload)
       VALUES (gen_random_uuid(), $1, 'notification.email', 'notification', gen_random_uuid(), '{"notificationIds":[]}')`,
      [tenantId],
    );
    await owner.end();

    // The exact claim statement the worker dispatcher issues.
    const claimed = await db.query(
      `UPDATE outbox_events
          SET locked_until = now() + (120 * interval '1 second'), locked_by = 'test-worker'
        WHERE id IN (
          SELECT id FROM outbox_events
           WHERE published_at IS NULL AND attempts < 10
             AND (locked_until IS NULL OR locked_until < now())
           ORDER BY created_at ASC LIMIT 50 FOR UPDATE SKIP LOCKED)
        RETURNING id, tenant_id AS "tenantId", event_type AS "eventType"`,
    );
    expect(claimed.rowCount).toBeGreaterThanOrEqual(1);
    expect(claimed.rows[0].eventType).toBeDefined();

    // Finalize (mark published) and clear the lease — worker-role writable.
    const done = await db.query(
      'UPDATE outbox_events SET published_at = now(), locked_until = NULL, locked_by = NULL WHERE id = $1 RETURNING id',
      [claimed.rows[0].id],
    );
    expect(done.rowCount).toBe(1);
  });
});
