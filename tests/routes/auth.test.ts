import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { authRoutes } from '../../src/routes/auth.js';
import { errorHandler } from '../../src/utils/errors.js';

async function buildTestApp() {
  const app = Fastify({ logger: false });
  await app.register(fastifyJwt, { secret: process.env.JWT_SECRET! });
  app.decorate('authenticate', async (req: any, rep: any) => {
    try { await req.jwtVerify(); } catch { rep.code(401).send({ error: 'Unauthorized' }); }
  });
  app.setErrorHandler(errorHandler);
  await app.register(authRoutes);
  await app.ready();
  return app;
}

let app: Awaited<ReturnType<typeof buildTestApp>>;

beforeAll(async () => { app = await buildTestApp(); });
afterAll(async () => { await app.close(); });

describe('POST /auth/token', () => {
  it('returns a JWT token for a valid API key', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/auth/token',
      payload: { apiKey: 'my-test-api-key-12345' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token).toBeDefined();
    expect(body.tokenType).toBe('Bearer');
    expect(body.expiresIn).toBe(86400);
    expect(body.userId).toBeDefined();
  });

  it('returns the same userId for the same API key', async () => {
    const res1 = await app.inject({ method: 'POST', url: '/auth/token', payload: { apiKey: 'stable-key-abc-123' } });
    const res2 = await app.inject({ method: 'POST', url: '/auth/token', payload: { apiKey: 'stable-key-abc-123' } });
    expect(JSON.parse(res1.body).userId).toBe(JSON.parse(res2.body).userId);
  });

  it('returns 422 for an API key shorter than 8 chars', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/auth/token',
      payload: { apiKey: 'short' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('returns 400/422 for missing apiKey', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/auth/token',
      payload: {},
    });
    expect([400, 422]).toContain(res.statusCode);
  });

  it('returns different tokens for different API keys', async () => {
    const res1 = await app.inject({ method: 'POST', url: '/auth/token', payload: { apiKey: 'key-alpha-111' } });
    const res2 = await app.inject({ method: 'POST', url: '/auth/token', payload: { apiKey: 'key-beta-222' } });
    expect(JSON.parse(res1.body).userId).not.toBe(JSON.parse(res2.body).userId);
  });
});

describe('GET /auth/me', () => {
  it('returns user info for a valid token', async () => {
    const tokenRes = await app.inject({
      method: 'POST', url: '/auth/token',
      payload: { apiKey: 'me-test-key-999' },
    });
    const { token } = JSON.parse(tokenRes.body);

    const meRes = await app.inject({
      method:  'GET',
      url:     '/auth/me',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(meRes.statusCode).toBe(200);
    const body = JSON.parse(meRes.body);
    expect(body.userId).toBeDefined();
    expect(body.role).toBe('user');
  });

  it('returns 401 without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(res.statusCode).toBe(401);
  });
});
