import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db/index.js';
import { getRedis } from '../services/pricing/cache.js';

export const healthRoutes: FastifyPluginAsync = async (fastify) => {

  // ── GET /health (liveness) ────────────────────────────────────────────────
  fastify.get('/health', async (_request, reply) => {
    return reply.send({
      status:    'ok',
      timestamp: new Date().toISOString(),
      uptime:    process.uptime(),
    });
  });

  // ── GET /ready (readiness — checks DB and Redis) ──────────────────────────
  fastify.get('/ready', async (_request, reply) => {
    const checks: Record<string, string> = {};
    let healthy = true;

    // Check PostgreSQL
    try {
      await pool.query('SELECT 1');
      checks.postgres = 'ok';
    } catch (err: any) {
      checks.postgres = 'error: ' + err.message;
      healthy = false;
    }

    // Check Redis
    try {
      const pong = await getRedis().ping();
      checks.redis = pong === 'PONG' ? 'ok' : 'unexpected response';
      if (pong !== 'PONG') healthy = false;
    } catch (err: any) {
      checks.redis = 'error: ' + err.message;
      healthy = false;
    }

    const code = healthy ? 200 : 503;
    return reply.code(code).send({
      status: healthy ? 'ready' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    });
  });
};
