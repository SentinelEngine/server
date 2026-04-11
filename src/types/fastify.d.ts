/**
 * Fastify instance augmentation — declares `authenticate` decorator and JWT
 * types so all route files see them without casting.
 */
import '@fastify/jwt';
import 'fastify';
import type { FastifyRequest, FastifyReply } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
}
