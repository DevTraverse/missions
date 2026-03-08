import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildApp } from '../src/app';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type App = Awaited<ReturnType<typeof buildApp>>;

function makeRequest(app: App, ip: string, path = '/api/search?q=test') {
  return app.inject({
    method: 'GET',
    url: path,
    headers: { 'x-forwarded-for': ip },
  });
}

function flushRedis(app: App) {
  return app.redis.flushall();
}

// ---------------------------------------------------------------------------
// 1-3  Basic functionality
// These tests must pass before any rate limiting is implemented.
// ---------------------------------------------------------------------------

describe('1-3: Basic functionality', () => {
  let app: App;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    await flushRedis(app);
  });

  afterAll(() => app.close());

  it('[1] GET /api/search returns 200', async () => {
    const res = await makeRequest(app, '10.0.0.1');
    expect(res.statusCode).toBe(200);
  });

  it('[2] response Content-Type is application/json', async () => {
    const res = await makeRequest(app, '10.0.0.1');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('[3] response body contains a results array', async () => {
    const res = await makeRequest(app, '10.0.0.1');
    const body = res.json();
    expect(body).toHaveProperty('results');
    expect(Array.isArray(body.results)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4-8  Rate limit threshold — 100 req/min, 101st returns 429
// ---------------------------------------------------------------------------

describe('4-8: Rate limit threshold (100 req/min)', () => {
  let app: App;
  const IP = '10.0.0.2';
  // 102 responses captured in beforeAll; indices 0-99 are 200, 100-101 are 429
  let responses: Awaited<ReturnType<typeof makeRequest>>[] = [];

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    await flushRedis(app);

    for (let i = 0; i < 102; i++) {
      responses.push(await makeRequest(app, IP));
    }
  });

  afterAll(() => app.close());

  it('[4] first request returns 200', () => {
    expect(responses[0].statusCode).toBe(200);
  });

  it('[5] request #50 returns 200 (well within limit)', () => {
    expect(responses[49].statusCode).toBe(200);
  });

  it('[6] request #100 returns 200 (exactly at the limit)', () => {
    expect(responses[99].statusCode).toBe(200);
  });

  it('[7] request #101 returns 429 Too Many Requests', () => {
    expect(responses[100].statusCode).toBe(429);
  });

  it('[8] requests beyond the limit continue returning 429', () => {
    expect(responses[101].statusCode).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// 9-11  Retry-After header on 429 responses
// ---------------------------------------------------------------------------

describe('9-11: Retry-After header', () => {
  let app: App;
  const IP = '10.0.0.3';
  let limitedRes: Awaited<ReturnType<typeof makeRequest>>;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    await flushRedis(app);

    // Exhaust the limit (100 allowed requests)
    for (let i = 0; i < 100; i++) {
      await makeRequest(app, IP);
    }

    // Capture request #101 — the first rate-limited response
    limitedRes = await makeRequest(app, IP);
  });

  afterAll(() => app.close());

  it('[9] 429 response includes a Retry-After header', () => {
    expect(limitedRes.statusCode).toBe(429);
    expect(limitedRes.headers['retry-after']).toBeDefined();
  });

  it('[10] Retry-After value is a numeric string (integer)', () => {
    const val = Number(limitedRes.headers['retry-after']);
    expect(Number.isInteger(val)).toBe(true);
  });

  it('[11] Retry-After value is between 1 and 60 seconds', () => {
    const ttl = Number(limitedRes.headers['retry-after']);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });
});

// ---------------------------------------------------------------------------
// 12-15  X-RateLimit-Remaining header — counts down with each request
//
// State accumulates across these tests; they must run in order.
// After test 12 the Redis counter is 1, after test 13 it is 2, etc.
// ---------------------------------------------------------------------------

describe('12-15: X-RateLimit-Remaining header', () => {
  let app: App;
  const IP = '10.0.0.4';

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    await flushRedis(app);
  });

  afterAll(() => app.close());

  it('[12] first request has X-RateLimit-Remaining: 99', async () => {
    // count → 1, remaining = 100 - 1 = 99
    const res = await makeRequest(app, IP);
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-ratelimit-remaining']).toBe('99');
  });

  it('[13] second request has X-RateLimit-Remaining: 98', async () => {
    // count → 2, remaining = 100 - 2 = 98
    const res = await makeRequest(app, IP);
    expect(res.headers['x-ratelimit-remaining']).toBe('98');
  });

  it('[14] request #100 has X-RateLimit-Remaining: 0', async () => {
    // count is 2 after tests 12+13; advance to count=99 with 97 more requests
    for (let i = 0; i < 97; i++) {
      await makeRequest(app, IP);
    }
    // count → 100, remaining = 100 - 100 = 0
    const res = await makeRequest(app, IP);
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-ratelimit-remaining']).toBe('0');
  });

  it('[15] request #101 returns 429 with no X-RateLimit-Remaining header', async () => {
    // count → 101, over limit
    const res = await makeRequest(app, IP);
    expect(res.statusCode).toBe(429);
    expect(res.headers['x-ratelimit-remaining']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 16-17  Window sliding — requests succeed again after the window expires
//
// Uses a short window (5 req / 1 s) so the test doesn't have to wait 60 s.
// beforeEach flushes Redis so each test gets a clean slate.
// ---------------------------------------------------------------------------

describe('16-17: Window sliding', () => {
  let app: App;
  const IP_16 = '10.0.0.5';
  const IP_17 = '10.0.0.6';

  beforeAll(async () => {
    app = await buildApp({ rateLimitMax: 5, rateLimitWindow: 1 });
    await app.ready();
  });

  afterAll(() => app.close());

  beforeEach(() => flushRedis(app));

  it('[16] requests succeed again after the window expires', async () => {
    // Exhaust the 5-request limit
    for (let i = 0; i < 5; i++) {
      await makeRequest(app, IP_16);
    }

    // Request #6 must be rate limited
    const over = await makeRequest(app, IP_16);
    expect(over.statusCode).toBe(429);

    // Wait for the 1-second window to expire
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // New window: counter reset — request should succeed
    const fresh = await makeRequest(app, IP_16);
    expect(fresh.statusCode).toBe(200);
  });

  it('[17] after window expiry the full quota resets to the limit', async () => {
    // Exhaust the 5-request limit
    for (let i = 0; i < 5; i++) {
      await makeRequest(app, IP_17);
    }

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // All 5 slots of the new window are available
    const results: number[] = [];
    let lastRes: Awaited<ReturnType<typeof makeRequest>> | null = null;
    for (let i = 0; i < 5; i++) {
      lastRes = await makeRequest(app, IP_17);
      results.push(lastRes.statusCode);
    }
    expect(results).toEqual([200, 200, 200, 200, 200]);
    // Quota is fully consumed — X-RateLimit-Remaining is 0 on the 5th request
    expect(lastRes!.headers['x-ratelimit-remaining']).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// 18-19  Redis persistence — rate limit state survives a server restart
// ---------------------------------------------------------------------------

describe('18-19: Redis persistence across server restarts', () => {
  const IP = '10.0.0.7';
  let app2: App;

  beforeAll(async () => {
    // Simulate "original server": make 60 requests then shut down
    const app1 = await buildApp();
    await app1.ready();
    await flushRedis(app1);

    for (let i = 0; i < 60; i++) {
      await makeRequest(app1, IP);
    }

    await app1.close(); // Redis key persists after the connection closes

    // Simulate "restarted server": fresh Fastify instance, same Redis
    app2 = await buildApp();
    await app2.ready();
  });

  afterAll(() => app2.close());

  it('[18] new app instance reads persisted counter — remaining reflects prior 60 requests', async () => {
    // count → 61, remaining = 100 - 61 = 39
    const res = await makeRequest(app2, IP);
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-ratelimit-remaining']).toBe('39');
  });

  it('[19] limit is enforced based on persisted counter — 101st request returns 429', async () => {
    // After test 18 the counter is at 61.
    // Advance to 99 with 38 more requests (counts 62-99).
    for (let i = 0; i < 38; i++) {
      await makeRequest(app2, IP);
    }

    // count → 100 (last allowed request)
    const hundredth = await makeRequest(app2, IP);
    expect(hundredth.statusCode).toBe(200);
    expect(hundredth.headers['x-ratelimit-remaining']).toBe('0');

    // count → 101 (over limit)
    const overLimit = await makeRequest(app2, IP);
    expect(overLimit.statusCode).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// 20  Independent rate limits per IP
// ---------------------------------------------------------------------------

describe('20: Independent rate limits per IP', () => {
  let app: App;
  const IP_A = '10.0.0.8';
  const IP_B = '10.0.0.9';

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    await flushRedis(app);
  });

  afterAll(() => app.close());

  it('[20] exhausting the limit for one IP does not affect a different IP', async () => {
    // Exhaust IP_A: 101 requests pushes count to 101, triggering 429 on the last
    for (let i = 0; i < 101; i++) {
      await makeRequest(app, IP_A);
    }

    // Confirm IP_A is rate limited
    const ipARes = await makeRequest(app, IP_A);
    expect(ipARes.statusCode).toBe(429);

    // IP_B has never been seen — must get 200 with full quota
    const ipBRes = await makeRequest(app, IP_B);
    expect(ipBRes.statusCode).toBe(200);
    expect(ipBRes.headers['x-ratelimit-remaining']).toBe('99');
  });
});
