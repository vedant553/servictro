import request from 'supertest';
import { startApi } from './helpers';

/**
 * Rate limiting (audit SEC-02): spawns a dedicated process with tight limits
 * (the shared suite runs with RATE_LIMITING=off so unrelated specs are not
 * throttled). Verifies 429 semantics for the global window and the stricter
 * auth window on login.
 */

const API_PORT = 4014;
const UNIQUE = Date.now().toString(36);

describe('rate limiting (SEC-02)', () => {
  let server: ReturnType<typeof request>;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const harness = await startApi(API_PORT, {
      RATE_LIMITING: 'on',
      THROTTLE_LIMIT: '5',
      THROTTLE_TTL_MS: '60000',
    });
    server = harness.server;
    stop = harness.stop;
  }, 120_000);

  afterAll(async () => {
    await stop();
  });

  it('throttles beyond the global window with 429 RATE_LIMITED', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await server.get('/health/live');
      statuses.push(res.status);
    }
    // First 5 pass, the 6th+ are throttled (429 with the standard envelope).
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
    expect(statuses[6]).toBe(429);
  });

  it('returns the standard error envelope with RATE_LIMITED code', async () => {
    const res = await server.get('/health/live');
    expect(res.status).toBe(429);
    expect(res.body.error?.code).toBe('RATE_LIMITED');
    expect(res.body.meta?.requestId).toBeDefined();
  });

  it('auth endpoints have their own (stricter) window: 10 logins/minute', async () => {
    const email = `ratelimit.${UNIQUE}@test.example`;
    // Burn the remaining global budget on a DIFFERENT tracker (the login
    // route throttles by IP for anonymous requests — same IP as the health
    // checks, but a different per-route bucket).
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await server.post('/api/v1/auth/login').send({ email, password: 'WrongPassword#1' });
      statuses.push(res.status);
    }
    // 10 attempts land within the auth window; the 11th+ are throttled.
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect(statuses[11]).toBe(429);
  });
});
