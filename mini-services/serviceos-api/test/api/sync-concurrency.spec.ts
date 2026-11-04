import request from 'supertest';
import { Client } from 'pg';
import { startApi, call, auth, inviteMember, createAssignedWorkOrder } from './helpers';

/**
 * Mobile synchronization concurrency + bounded/incremental job packs
 * (audit DATA-02 / DATA-03 / DATA-07).
 *
 * Scenarios:
 *  1. CONCURRENT DUPLICATE PUSH — two devices push the SAME operationId at
 *     the same instant: exactly one observation row is created; one request
 *     sees accepted, the other duplicate. The pre-remediation code applied
 *     the operation twice (check + apply + record were separate transactions).
 *  2. SEQUENTIAL REPLAY — re-pushing a known operationId returns duplicate
 *     without re-applying.
 *  3. PUSH RESPONSE SEMANTICS — conflicts/rejections are reported per op.
 *  4. BOUNDED JOB PACKS — limit is honored and hasMore/nextSince drive
 *     incremental pagination; `since` filters unchanged work orders.
 */

const API_PORT = 4011;
const UNIQUE = Date.now().toString(36);

const TEST_DB = 'postgresql://postgres:postgres@127.0.0.1:5433/serviceos_test';

const mutation = (operationId: string, entityId: string, baseVersion: number, text: string) => ({
  operationId,
  entityType: 'work_order',
  entityId,
  operation: 'observation',
  baseVersion,
  payload: { text, kind: 'observation' },
  deviceObservedAt: new Date().toISOString(),
});

describe('mobile sync — atomic idempotency (DATA-02)', () => {
  let server: ReturnType<typeof request>;
  let stop: () => Promise<void>;
  let ownerToken: string;
  let techToken: string;
  let techUserId: string;
  let workOrderId: string;
  let workOrderVersion: number;

  beforeAll(async () => {
    const harness = await startApi(API_PORT);
    server = harness.server;
    stop = harness.stop;

    const org = await call(server.post('/api/v1/auth/register').send({
      email: `owner.sync.${UNIQUE}@test.example`,
      password: 'TestPassword#123',
      displayName: 'Sync Owner',
      organizationName: `Sync Tenant ${UNIQUE}`,
    }));
    ownerToken = org.body.data.accessToken;

    const tech = await inviteMember(
      server,
      ownerToken,
      `tech.sync.${UNIQUE}@test.example`,
      'TechPassword#123',
      'technician',
      'Sync Tech',
    );
    techToken = tech.token;
    techUserId = tech.userId;

    const wo = await createAssignedWorkOrder(server, ownerToken, techUserId, UNIQUE);
    workOrderId = wo.workOrderId;
    workOrderVersion = wo.version;
  }, 120_000);

  afterAll(async () => {
    await stop();
  });

  it('applies a pushed observation exactly once (baseline)', async () => {
    const res = await call(
      server.post('/api/v1/mobile/sync/push').set(auth(techToken)).send({
        deviceId: '00000000-0000-4000-8000-0000000000a1',
        mutations: [mutation('00000000-0000-4000-8000-00000000ba01', workOrderId, workOrderVersion, 'Baseline observation')],
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.data.results[0].result).toBe('accepted');
  });

  it('CONCURRENT duplicate push applies the operation EXACTLY ONCE', async () => {
    const operationId = '00000000-0000-4000-8000-00000000ba02';
    const payload = {
      deviceId: '00000000-0000-4000-8000-0000000000a2',
      mutations: [mutation(operationId, workOrderId, workOrderVersion, 'Concurrent observation')],
    };
    // Two devices race with the same operationId. The loser may observe the
    // claim as 'pending' (race during apply) or 'duplicate' (after finalize)
    // — either way exactly ONE application may occur.
    const [first, second] = await Promise.all([
      server.post('/api/v1/mobile/sync/push').set(auth(techToken)).send(payload),
      server.post('/api/v1/mobile/sync/push').set(auth(techToken)).send(payload),
    ]);

    const results = [first.body.data.results[0].result, second.body.data.results[0].result];
    expect(results.filter((r: string) => r === 'accepted')).toHaveLength(1);
    expect(['duplicate', 'pending']).toContain(results.find((r: string) => r !== 'accepted'));

    // Exactly ONE observation row for this operation exists server-side.
    const client = new Client({ connectionString: TEST_DB });
    await client.connect();
    const rows = await client.query(
      'SELECT count(*)::int AS n FROM service_observations WHERE work_order_id = $1 AND text = $2',
      [workOrderId, 'Concurrent observation'],
    );
    const ops = await client.query(
      'SELECT count(*)::int AS n FROM mobile_sync_operations WHERE operation_id = $1',
      [operationId],
    );
    await client.end();
    expect(rows.rows[0].n).toBe(1);
    expect(ops.rows[0].n).toBe(1);
  });

  it('sequential replay returns duplicate without re-applying', async () => {
    const operationId = '00000000-0000-4000-8000-00000000ba03';
    const payload = {
      deviceId: '00000000-0000-4000-8000-0000000000a3',
      mutations: [mutation(operationId, workOrderId, workOrderVersion, 'Replay observation')],
    };
    const first = await call(server.post('/api/v1/mobile/sync/push').set(auth(techToken)).send(payload));
    expect(first.body.data.results[0].result).toBe('accepted');

    const replay = await call(server.post('/api/v1/mobile/sync/push').set(auth(techToken)).send(payload));
    expect(replay.body.data.results[0].result).toBe('duplicate');
    expect(replay.body.data.results[0].serverVersion).toBe(first.body.data.results[0].serverVersion);

    const client = new Client({ connectionString: TEST_DB });
    await client.connect();
    const rows = await client.query(
      'SELECT count(*)::int AS n FROM service_observations WHERE work_order_id = $1 AND text = $2',
      [workOrderId, 'Replay observation'],
    );
    await client.end();
    expect(rows.rows[0].n).toBe(1);
  });

  it('reports a stale base version as a conflict, not a crash', async () => {
    // Transitions carry optimistic concurrency (expectedVersion); an
    // observation is an append and cannot conflict on version.
    const res = await call(
      server.post('/api/v1/mobile/sync/push').set(auth(techToken)).send({
        deviceId: '00000000-0000-4000-8000-0000000000a4',
        mutations: [
          {
            operationId: '00000000-0000-4000-8000-00000000ba04',
            entityType: 'work_order',
            entityId: workOrderId,
            operation: 'transition',
            baseVersion: 1, // stale by construction
            payload: { toStatus: 'on_hold' },
            deviceObservedAt: new Date().toISOString(),
          },
        ],
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.data.results[0].result).toBe('conflict');
    expect(res.body.data.results[0].error).toBe('VERSION_CONFLICT');
  });

  it('rejects mutations on work orders the technician is not assigned to', async () => {
    // A second technician without assignments.
    const outsider = await inviteMember(
      server,
      ownerToken,
      `tech.out.${UNIQUE}@test.example`,
      'OutPassword#123',
      'technician',
      'Outsider Tech',
    );
    const res = await call(
      server.post('/api/v1/mobile/sync/push').set(auth(outsider.token)).send({
        deviceId: '00000000-0000-4000-8000-0000000000a5',
        mutations: [mutation('00000000-0000-4000-8000-00000000ba05', workOrderId, workOrderVersion, 'Outsider observation')],
      }),
    );
    expect(res.body.data.results[0].result).toBe('conflict');
    expect(res.body.data.results[0].error).toBe('NOT_ASSIGNED');
  });
});

describe('mobile job packs — bounded + incremental (DATA-07)', () => {
  let server: ReturnType<typeof request>;
  let stop: () => Promise<void>;
  let ownerToken: string;
  let techToken: string;
  let techUserId: string;

  beforeAll(async () => {
    const harness = await startApi(API_PORT);
    server = harness.server;
    stop = harness.stop;

    const org = await call(server.post('/api/v1/auth/register').send({
      email: `owner.pack.${UNIQUE}@test.example`,
      password: 'TestPassword#123',
      displayName: 'Pack Owner',
      organizationName: `Pack Tenant ${UNIQUE}`,
    }));
    ownerToken = org.body.data.accessToken;
    const tech = await inviteMember(
      server,
      ownerToken,
      `tech.pack.${UNIQUE}@test.example`,
      'TechPassword#123',
      'technician',
      'Pack Tech',
    );
    techToken = tech.token;
    techUserId = tech.userId;

    // Three assigned work orders.
    for (let i = 0; i < 3; i++) {
      await createAssignedWorkOrder(server, ownerToken, techUserId, `${UNIQUE}${i}`);
    }
  }, 120_000);

  afterAll(async () => {
    await stop();
  });

  it('returns a bounded job pack with pagination metadata', async () => {
    const res = await call(server.get('/api/v1/mobile/job-packs?limit=2').set(auth(techToken)));
    expect(res.status).toBe(200);
    expect(res.body.data.jobs.length).toBeLessThanOrEqual(2);
    expect(typeof res.body.data.hasMore).toBe('boolean');
    expect(typeof res.body.data.nextSince).toBe('string');
    expect(typeof res.body.data.syncedAt).toBe('string');
    expect(res.body.data.limit).toBe(2);
  });

  it('caps an abusive limit at the server maximum (200)', async () => {
    const res = await call(server.get('/api/v1/mobile/job-packs?limit=100000').set(auth(techToken)));
    expect(res.status).toBe(200);
    expect(res.body.data.limit).toBe(200);
  });

  it('increments with the since cursor: unchanged work orders are skipped', async () => {
    const full = await call(server.get('/api/v1/mobile/job-packs').set(auth(techToken)));
    expect(full.body.data.hasMore).toBe(false);

    // Nothing changed since syncedAt → empty delta, cursor advances.
    const delta = await call(
      server.get(`/api/v1/mobile/job-packs?since=${encodeURIComponent(full.body.data.syncedAt)}`).set(auth(techToken)),
    );
    expect(delta.status).toBe(200);
    expect(delta.body.data.jobs).toHaveLength(0);

    // A new assignment appears in the next incremental pull.
    const created = await createAssignedWorkOrder(server, ownerToken, techUserId, `${UNIQUE}x`);
    const delta2 = await call(
      server.get(`/api/v1/mobile/job-packs?since=${encodeURIComponent(full.body.data.syncedAt)}`).set(auth(techToken)),
    );
    expect(delta2.body.data.jobs.map((j: { id: string }) => j.id)).toContain(created.workOrderId);
  });

  it('rejects a malformed since cursor', async () => {
    const res = await call(server.get('/api/v1/mobile/job-packs?since=not-a-date').set(auth(techToken)));
    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe('SYNC_CURSOR_INVALID');
  });
});
