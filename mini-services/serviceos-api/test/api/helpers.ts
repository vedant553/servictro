import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import request from 'supertest';

/**
 * Shared harness for the integration suites: boots the COMPILED API server
 * (dist/main.js) against the isolated test database with the same code path
 * production runs, then exposes terse helpers for tenant bootstrap.
 */

export interface ApiHarness {
  server: ReturnType<typeof request>;
  child: ChildProcess;
  stop: () => Promise<void>;
}

export async function startApi(port: number, env: NodeJS.ProcessEnv = {}): Promise<ApiHarness> {
  const child = spawn('node', ['dist/main.js'], {
    cwd: resolve(__dirname, '../..'),
    env: {
      ...process.env,
      PORT: String(port),
      ENABLE_SWAGGER: 'false',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 90; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health/ready`);
      if (res.ok) break;
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 500));
    if (i === 89) throw new Error('test API server failed to become ready');
  }
  return {
    server: request(`http://127.0.0.1:${port}`),
    child,
    stop: async () => {
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
    },
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Envelope<T = any> {
  data: T;
  error?: { code: string; message: string; details?: Array<{ field: string; reason: string }> };
}

export async function call(fn: request.Test): Promise<{ status: number; body: Envelope }> {
  const res = await fn;
  return { status: res.status, body: res.body as Envelope };
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export const register = (server: ReturnType<typeof request>, body: object) =>
  server.post('/api/v1/auth/register').send(body);
export const login = (server: ReturnType<typeof request>, email: string, password: string) =>
  server.post('/api/v1/auth/login').send({ email, password });

/** Invite + accept a member with the given role; returns their access token. */
export async function inviteMember(
  server: ReturnType<typeof request>,
  ownerToken: string,
  email: string,
  password: string,
  role: string,
  displayName: string,
): Promise<{ token: string; userId: string }> {
  const invite = await call(server.post('/api/v1/team/invitations').set(auth(ownerToken)).send({ email, role }));
  if (invite.status !== 201) throw new Error(`invitation failed: ${JSON.stringify(invite.body)}`);
  const token = invite.body.data.acceptUrl.split('invite=')[1];
  const joined = await call(
    register(server, {
      email,
      password,
      displayName,
      organizationName: 'ignored',
      invitationToken: token,
    }),
  );
  if (joined.status !== 201) throw new Error(`join failed: ${JSON.stringify(joined.body)}`);
  const loggedIn = await call(login(server, email, password));
  return { token: loggedIn.body.data.accessToken, userId: loggedIn.body.data.user.id };
}

/** Full chain: customer → site → asset → request → work order → assigned+ready. */
export async function createAssignedWorkOrder(
  server: ReturnType<typeof request>,
  ownerToken: string,
  techUserId: string,
  unique: string,
): Promise<{ workOrderId: string; version: number; assetId: string; customerId: string; siteId: string }> {
  const customer = await call(server.post('/api/v1/customers').set(auth(ownerToken)).send({
    legalName: `Sync Industries ${unique}`,
    segment: 'Pharmaceutical',
  }));
  const customerId = customer.body.data.id;
  const site = await call(server.post('/api/v1/sites').set(auth(ownerToken)).send({
    customerId,
    siteCode: `SY-${unique}`,
    name: 'Sync Plant',
    address: { line1: 'Plot 9', city: 'Pune', state: 'MH', country: 'IN' },
  }));
  const siteId = site.body.data.id;
  const asset = await call(server.post('/api/v1/assets').set(auth(ownerToken)).send({
    siteId,
    serialNumber: `SN-${unique}`,
    assetFamily: 'lt_panel',
    manufacturer: 'Sync Panels',
    model: 'SP-415',
    commissioningDate: '2026-02-01',
  }));
  const assetId = asset.body.data.id;
  const req = await call(server.post('/api/v1/service-requests').set(auth(ownerToken)).send({
    customerId,
    siteId,
    assetId,
    source: 'phone',
    category: 'breakdown',
    subject: `Feeder fault ${unique}`,
    description: 'Integration harness request.',
    severity: 'medium',
  }));
  if (req.status !== 201) throw new Error(`request create failed: ${JSON.stringify(req.body)}`);
  const requestId = req.body.data.id;
  const triage = await call(server.post(`/api/v1/service-requests/${requestId}/triage`).set(auth(ownerToken)).send({ severity: 'medium' }));
  if (triage.status !== 200 && triage.status !== 201) throw new Error(`triage failed: ${JSON.stringify(triage.body)}`);
  const accepted = await call(server.post(`/api/v1/service-requests/${requestId}/accept`).set(auth(ownerToken)).send({}));
  if (accepted.status !== 200 && accepted.status !== 201) throw new Error(`accept failed: ${JSON.stringify(accepted.body)}`);
  const converted = await call(server.post(`/api/v1/service-requests/${requestId}/convert`).set(auth(ownerToken)).send({
    type: 'breakdown',
    priority: 'normal',
    coverageOverrideReason: 'Goodwill integration test visit',
  }));
  if (converted.status !== 201) throw new Error(`convert failed: ${JSON.stringify(converted.body)}`);
  const workOrderId = converted.body.data.id;
  await call(server.post(`/api/v1/work-orders/${workOrderId}/transitions`).set(auth(ownerToken)).send({ toStatus: 'ready' }));
  await call(server.patch(`/api/v1/work-orders/${workOrderId}`).set(auth(ownerToken)).send({
    scheduledStartAt: '2026-12-01T05:30:00Z',
    scheduledEndAt: '2026-12-01T09:30:00Z',
  }));
  await call(server.post(`/api/v1/work-orders/${workOrderId}/assignments`).set(auth(ownerToken)).send({ userId: techUserId }));
  await call(server.post(`/api/v1/work-orders/${workOrderId}/transitions`).set(auth(ownerToken)).send({ toStatus: 'scheduled' }));
  const fetched = await call(server.get(`/api/v1/work-orders/${workOrderId}`).set(auth(ownerToken)));
  return {
    workOrderId,
    version: fetched.body.data.version,
    assetId,
    customerId,
    siteId,
  };
}
