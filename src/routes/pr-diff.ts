/**
 * PR diff routes — blockchain-anchored cost diff per pull request.
 *
 * POST /pr-diff        — store + anchor a PR cost diff
 * GET  /pr-diff/:prId  — fetch + verify an anchored PR diff
 */
import type { FastifyPluginAsync } from 'fastify';
import { z }          from 'zod';
import { createHash } from 'node:crypto';
import { db }         from '../db/index.js';
import { prDiffs }    from '../db/schema.js';
import { eq, desc }   from 'drizzle-orm';
import { canonicalize }    from '../utils/canonicalize.js';
import { storeHash, getOnChainRecord } from '../services/blockchain/index.js';

// ── Schemas ───────────────────────────────────────────────────────────────────

const ServiceCostSchema = z.object({
  service:      z.string(),
  monthlyCents: z.number(),
  breakdown:    z.record(z.number()).optional(),
});

const PrDiffBodySchema = z.object({
  prId:     z.string().min(1).max(200),
  prTitle:  z.string().max(500).default(''),
  author:   z.string().max(200).default('unknown'),
  baseCost: z.object({
    total:    z.number(),    // monthly cents
    services: z.array(ServiceCostSchema).default([]),
  }),
  headCost: z.object({
    total:    z.number(),
    services: z.array(ServiceCostSchema).default([]),
  }),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildServiceBreakdownDiff(
  base: z.infer<typeof ServiceCostSchema>[],
  head: z.infer<typeof ServiceCostSchema>[],
) {
  const baseMap = new Map(base.map(s => [s.service, s.monthlyCents]));
  const headMap = new Map(head.map(s => [s.service, s.monthlyCents]));
  const allServices = new Set([...baseMap.keys(), ...headMap.keys()]);

  const diff: Record<string, { base: number; head: number; delta: number }> = {};
  for (const svc of allServices) {
    const b = baseMap.get(svc) ?? 0;
    const h = headMap.get(svc) ?? 0;
    diff[svc] = { base: b, head: h, delta: h - b };
  }
  return diff;
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export const prDiffRoutes: FastifyPluginAsync = async (fastify) => {

  // ── POST /pr-diff ─────────────────────────────────────────────────────────
  fastify.post('/pr-diff', async (request, reply) => {
    const body = PrDiffBodySchema.parse(request.body);

    const delta         = body.headCost.total - body.baseCost.total;
    const percentChange = body.baseCost.total > 0
      ? Math.round((delta / body.baseCost.total) * 10_000) / 100
      : body.headCost.total > 0 ? 100 : 0;

    const serviceBreakdown = buildServiceBreakdownDiff(
      body.baseCost.services,
      body.headCost.services,
    );

    // 1. Build canonical diff JSON
    const diffPayload = {
      author:          body.author,
      baseMonthlyCost: body.baseCost.total,
      breakdown:       serviceBreakdown,
      delta,
      headMonthlyCost: body.headCost.total,
      percentChange,
      prId:            body.prId,
      prTitle:         body.prTitle,
      timestamp:       new Date().toISOString(),
    };

    const canonical = canonicalize(diffPayload);

    // 2. SHA-256
    const hash = createHash('sha256').update(canonical).digest('hex');

    // 3. Insert into DB
    const [row] = await db.insert(prDiffs).values({
      prId:    body.prId,
      prTitle: body.prTitle,
      author:  body.author,
      diffJson: diffPayload as any,
      hash,
      txHash:     'pending',
      explorerUrl: '',
      anchored:   false,
    }).returning({ id: prDiffs.id });

    const diffId  = row.id;
    const chainId = `pr-${body.prId}`;

    // 4. Anchor on-chain
    const { txHash, explorerUrl, anchored } = await storeHash(chainId, hash, 'pr-diff');

    // 5. Update row
    await db.update(prDiffs)
      .set({ txHash, explorerUrl, anchored })
      .where(eq(prDiffs.id, diffId));

    request.log.info(
      { prId: body.prId, delta, hash: hash.slice(0, 16) + '…', anchored },
      'PR diff anchored',
    );

    return reply.code(201).send({
      diffId,
      diff: diffPayload,
      hash,
      txHash,
      explorerUrl,
      anchored,
    });
  });

  // ── GET /pr-diff ──────────────────────────────────────────────────────────
  fastify.get('/pr-diff', async (_request, reply) => {
    const rows = await db.select().from(prDiffs)
      .orderBy(desc(prDiffs.createdAt))
      .limit(20);

    return reply.send(rows.map(r => ({
      id:          r.id,
      prId:        r.prId,
      prTitle:     r.prTitle,
      author:      r.author,
      hash:        r.hash,
      txHash:      r.txHash,
      explorerUrl: r.explorerUrl,
      anchored:    r.anchored,
      createdAt:   r.createdAt,
    })));
  });

  // ── GET /pr-diff/:prId ────────────────────────────────────────────────────
  fastify.get<{ Params: { prId: string } }>(
    '/pr-diff/:prId',
    async (request, reply) => {
      const { prId } = request.params;

      const rows = await db.select().from(prDiffs)
        .where(eq(prDiffs.prId, prId))
        .orderBy(desc(prDiffs.createdAt))
        .limit(1);

      if (!rows.length) {
        return reply.code(404).send({ error: 'PR diff not found', prId });
      }

      const row       = rows[0];
      const recomputed = createHash('sha256')
        .update(canonicalize(row.diffJson))
        .digest('hex');

      const chainId       = `pr-${prId}`;
      const onChainRecord = await getOnChainRecord(chainId);
      const onChain       = onChainRecord?.hash ?? null;

      const dbMatch    = recomputed === row.hash;
      const chainMatch = onChain ? onChain === row.hash : null;
      const authentic  = dbMatch && (chainMatch !== false);

      return reply.send({
        authentic,
        diff:       row.diffJson,
        hash:       row.hash,
        recomputed,
        onChain,
        chainMatch,
        txHash:     row.txHash,
        explorerUrl: row.explorerUrl,
        anchored:   row.anchored,
        createdAt:  row.createdAt,
      });
    },
  );
};
