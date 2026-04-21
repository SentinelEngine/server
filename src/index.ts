import Fastify          from 'fastify';
import fastifyJwt       from '@fastify/jwt';
import fastifyWebsocket from '@fastify/websocket';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyCors      from '@fastify/cors';

import { config }         from './config.js';
import { errorHandler }   from './utils/errors.js';
import { addRequestId }   from './middleware/request-id.js';
import { authenticate }   from './middleware/auth.js';
import { analyzeRoutes }  from './routes/analyze.js';
import { authRoutes }     from './routes/auth.js';
import { googleAuthRoutes } from './routes/googleAuth.js';
import { pricingRoutes }  from './routes/pricing.js';
import { historyRoutes }  from './routes/history.js';
import { healthRoutes }   from './routes/health.js';
import { reportRoutes }   from './routes/report.js';
import { prDiffRoutes }   from './routes/pr-diff.js';
import { webhookRoutes }  from './routes/webhook.js';
import { botRoutes }      from './routes/bot.js';

// ─── Build app ───────────────────────────────────────────────────────────────

const app = Fastify({
  logger: {
    level: config.LOG_LEVEL,
    ...(config.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } } }
      : {}),
  },
  trustProxy:    true,
  disableRequestLogging: false,
});

// Augment Fastify instance with `authenticate` decorator
app.decorate('authenticate', authenticate);

// ─── Plugins ─────────────────────────────────────────────────────────────────

await app.register(fastifyCors, {
  origin:  true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
});

await app.register(fastifyJwt, {
  secret: config.JWT_SECRET,
});

await app.register(fastifyWebsocket);

await app.register(fastifyRateLimit, {
  max:        config.RATE_LIMIT_MAX,
  timeWindow: config.RATE_LIMIT_WINDOW,
  keyGenerator: (req) => (req.user as any)?.sub ?? req.ip,
  errorResponseBuilder: (_req, ctx) => ({
    error:       'Too Many Requests',
    message:     `Rate limit exceeded. Try again in ${ctx.after}`,
    statusCode:  429,
  }),
});

// ─── Hooks ────────────────────────────────────────────────────────────────────

app.addHook('onRequest', addRequestId);

// ─── Error handler ────────────────────────────────────────────────────────────

app.setErrorHandler(errorHandler);

// ─── Routes ──────────────────────────────────────────────────────────────────

await app.register(healthRoutes);
await app.register(authRoutes);
await app.register(googleAuthRoutes);
await app.register(analyzeRoutes);
await app.register(pricingRoutes, { prefix: '/pricing' });
await app.register(historyRoutes, { prefix: '/history' });
await app.register(reportRoutes);
await app.register(prDiffRoutes);
await app.register(webhookRoutes);
await app.register(botRoutes);

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(): Promise<void> {
  app.log.info('Received shutdown signal, closing server…');
  await app.close();
  process.exit(0);
}

(['SIGINT', 'SIGTERM'] as NodeJS.Signals[]).forEach(sig =>
  process.on(sig, () => { shutdown().catch(() => process.exit(1)); }),
);

// ─── Start ────────────────────────────────────────────────────────────────────

try {
  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info(`🚀 Cloud Cost Analyzer listening on ${config.HOST}:${config.PORT}`);
} catch (err) {
  app.log.fatal(err, 'Failed to start server');
  process.exit(1);
}

export { app };
