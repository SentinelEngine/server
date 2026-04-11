import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { healthRoutes } from '../../src/routes/health.js';
import { errorHandler } from '../../src/utils/errors.js';
import { pool } from '../../src/db/index.js';

// Minimal test app that doesn't need DB or Redis
async function buildTestApp() {
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: process.env.JWT_SECRET! });
  app.decorate('authenticate', async (req: any, rep: any) => {
    try { await req.jwtVerify(); } catch { rep.code(401).send({ error: 'Unauthorized' }); }
  });
  app.setErrorHandler(errorHandler);
  await app.register(healthRoutes);
  await app.ready();
  return app;
}

let app: Awaited<ReturnType<typeof buildTestApp>>;

beforeAll(async () => { app = await buildTestApp(); });
afterAll(async () => {
  await app.close();
  await pool.end().catch(() => { /* ignore */ });
});

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
    expect(body.timestamp).toBeDefined();
  });
});

describe('GET /ready', () => {
  it('returns 200 or 503 depending on connectivity', async () => {
    const res = await app.inject({ method: 'GET', url: '/ready' });
    // In a CI environment without DB/Redis this may be 503 — both are valid
    expect([200, 503]).toContain(res.statusCode);
    const body = JSON.parse(res.body);
    expect(body.status).toMatch(/^(ready|degraded)$/);
    expect(body.checks).toBeDefined();
  });
});
