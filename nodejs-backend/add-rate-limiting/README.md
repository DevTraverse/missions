# Mission: Add Rate Limiting

A minimal Fastify API with one search endpoint. Redis is already wired up and available inside the route handler. Your job is to add rate limiting.

## Setup

```bash
npm install
cp .env.example .env
# Start Redis (Docker example):
docker run -d -p 6379:6379 redis:7
npm run dev
```

## The mission

Open `src/routes/search.ts` and find the `// TODO: implement rate limiting here` comment inside the `GET /api/search` handler. Implement a fixed-window rate limiter that allows **100 requests per minute per IP address**. Use `app.redis` (an ioredis client) to store counters. When the limit is exceeded the server must return `429 Too Many Requests` with a `Retry-After` header. All successful responses must include an `X-RateLimit-Remaining` header.

Run the test suite to see where you stand:

```bash
npm test
```

All 20 tests should pass when your implementation is correct. Read `.dt/primer.md` for vocabulary reference if you need it.
