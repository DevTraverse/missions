import Fastify from 'fastify';
import redisPlugin from './plugins/redis';
import searchRoutes from './routes/search';

export interface AppOptions {
  rateLimitMax?: number;
  rateLimitWindow?: number;
  logger?: boolean;
}

export async function buildApp(opts: AppOptions = {}) {
  const app = Fastify({
    logger: opts.logger ?? false,
    trustProxy: true,
  });

  app.register(redisPlugin);
  app.register(searchRoutes, {
    rateLimitMax: opts.rateLimitMax ?? 100,
    rateLimitWindow: opts.rateLimitWindow ?? 60,
  });

  return app;
}
