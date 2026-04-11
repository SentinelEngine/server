import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * JWT authentication pre-handler.
 * Verifies the Bearer token in the Authorization header.
 * Attached to the Fastify instance as `fastify.authenticate`.
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    reply.code(401).send({ error: 'Unauthorized', code: 'INVALID_TOKEN' });
  }
}
