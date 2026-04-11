import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { db }                  from '../db/index.js';
import { analyses }            from '../db/schema.js';
import { AppError }            from '../utils/errors.js';

const PaginationSchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const historyRoutes: FastifyPluginAsync = async (fastify) => {

  // ── GET /history ──────────────────────────────────────────────────────────
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = (request.user as any).sub as string;
      const { page, limit } = PaginationSchema.parse(request.query);
      const offset = (page - 1) * limit;

      const rows = await db
        .select({
          id:           analyses.id,
          fileName:     analyses.fileName,
          language:     analyses.language,
          totalMonthly: analyses.totalMonthly,
          createdAt:    analyses.createdAt,
        })
        .from(analyses)
        .where(eq(analyses.userId, userId))
        .orderBy(desc(analyses.createdAt))
        .limit(limit)
        .offset(offset);

      return reply.send({
        data: rows,
        pagination: { page, limit, count: rows.length },
      });
    },
  );

  // ── GET /history/:id ──────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = (request.user as any).sub as string;
      const { id }   = request.params;

      const rows = await db
        .select()
        .from(analyses)
        .where(eq(analyses.id, id))
        .limit(1);

      if (!rows.length) throw AppError.notFound('Analysis not found');

      const row = rows[0];
      if (row.userId !== userId) throw AppError.forbidden('Access denied');

      return reply.send(row);
    },
  );
};
