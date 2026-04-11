import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createHash } from 'node:crypto';

const TokenSchema = z.object({
  apiKey: z.string().min(8, 'API key must be at least 8 characters'),
});

export const authRoutes: FastifyPluginAsync = async (fastify) => {

  // ── POST /auth/token ──────────────────────────────────────────────────────
  fastify.post('/auth/token', async (request, reply) => {
    const { apiKey } = TokenSchema.parse(request.body);

    // Derive a stable user ID from the API key (SHA-256 first 8 hex chars)
    const userId = createHash('sha256').update(apiKey).digest('hex').slice(0, 16);

    const token = fastify.jwt.sign(
      { sub: userId, role: 'user' },
      { expiresIn: '24h' },
    );

    return reply.send({
      token,
      tokenType: 'Bearer',
      expiresIn: 86400,
      userId,
    });
  });

  // ── GET /auth/me ──────────────────────────────────────────────────────────
  fastify.get('/auth/me', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const user = request.user as any;
    return reply.send({
      userId: user.sub,
      role:   user.role,
      iat:    user.iat,
      exp:    user.exp,
    });
  });
};
