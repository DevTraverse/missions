import { FastifyInstance, FastifyPluginOptions } from 'fastify';

interface SearchRouteOptions extends FastifyPluginOptions {
  rateLimitMax: number;
  rateLimitWindow: number;
}

interface SearchQuery {
  q?: string;
}

export default async function searchRoutes(
  app: FastifyInstance,
  opts: SearchRouteOptions,
) {
  const { rateLimitMax, rateLimitWindow } = opts;

  app.get<{ Querystring: SearchQuery }>('/api/search', async (request, reply) => {
    // TODO: implement rate limiting here
    //
    // Requirements:
    //   - Identify the client by IP: use request.ip (X-Forwarded-For is already
    //     parsed by Fastify because trustProxy is enabled in app.ts)
    //   - Redis key pattern: `rate_limit:${ip}` with a TTL of rateLimitWindow seconds
    //   - Algorithm: fixed-window counter using Redis INCR + EXPIRE
    //   - On every allowed request (200): set the X-RateLimit-Remaining response header
    //   - On rate-limited requests (429): do NOT set X-RateLimit-Remaining
    //   - When the limit is exceeded: reply with status 429, a Retry-After header
    //     (value = remaining TTL in seconds), and body { error: 'Too Many Requests' }
    //
    // Available:
    //   app.redis  — ioredis client
    //   rateLimitMax    — max requests per window (e.g. 100)
    //   rateLimitWindow — window size in seconds  (e.g. 60)

    const { q } = request.query;

    return {
      results: q
        ? [
            { id: 1, title: `Result for "${q}"`, score: 0.95 },
            { id: 2, title: `Another result for "${q}"`, score: 0.87 },
          ]
        : [],
    };
  });
}
