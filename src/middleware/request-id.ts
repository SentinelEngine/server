import { randomUUID } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Adds a unique X-Request-Id header to every response.
 * Register as an onRequest hook in the Fastify app.
 */
export function addRequestId(
  request: FastifyRequest,
  reply: FastifyReply,
  done: () => void,
): void {
  const id = (request.headers['x-request-id'] as string) ?? randomUUID();
  request.id = id;
  reply.header('X-Request-Id', id);
  done();
}
