import type { FastifyPluginAsync } from 'fastify';
import { getPricingForService } from '../services/pricing/index.js';
import { AppError } from '../utils/errors.js';

const SUPPORTED_SERVICES = new Set([
  'openai', 'anthropic', 'aws-lambda', 'dynamodb', 's3', 'api-gateway', 'redis',
]);

export const pricingRoutes: FastifyPluginAsync = async (fastify) => {

  // ── GET /pricing/:service ─────────────────────────────────────────────────
  fastify.get<{ Params: { service: string } }>(
    '/:service',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { service } = request.params;

      if (!SUPPORTED_SERVICES.has(service)) {
        throw AppError.notFound(
          `Service "${service}" is not supported. Supported: ${[...SUPPORTED_SERVICES].join(', ')}`,
        );
      }

      const result = await getPricingForService(service);
      return reply.send(result);
    },
  );

  // ── GET /pricing (list all) ───────────────────────────────────────────────
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate] },
    async (_request, reply) => {
      const results = await Promise.all(
        [...SUPPORTED_SERVICES].map(s => getPricingForService(s)),
      );
      return reply.send(results);
    },
  );
};
