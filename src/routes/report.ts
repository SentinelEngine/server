/**
 * Audit report routes — tamper-proof cost report anchoring & verification.
 *
 * POST /report        — create + anchor a new cost report
 * GET  /report        — list recent anchored reports
 * GET  /verify/:id    — verify a report's integrity (DB hash vs on-chain hash)
 */
import type { FastifyPluginAsync } from 'fastify';
import { z }             from 'zod';
import { createHash }    from 'node:crypto';
import { db }            from '../db/index.js';
import { auditReports }  from '../db/schema.js';
import { eq, desc }      from 'drizzle-orm';
import { canonicalize }  from '../utils/canonicalize.js';
import { storeHash, getOnChainRecord } from '../services/blockchain/index.js';

// ── Schemas ───────────────────────────────────────────────────────────────────

const ReportBodySchema = z.object({
  projectId:  z.string().min(1).max(200),
  filePath:   z.string().max(500).default('untitled'),
  detections: z.array(z.record(z.unknown())).default([]),
  estimate:   z.record(z.unknown()).default({}),
  author:     z.string().max(200).default('unknown'),
  timestamp:  z.string().datetime().default(() => new Date().toISOString()),
});

// ── Plugin ────────────────────────────────────────────────────────────────────

export const reportRoutes: FastifyPluginAsync = async (fastify) => {

  // ── POST /report ─────────────────────────────────────────────────────────
  fastify.post('/report', async (request, reply) => {
    const body = ReportBodySchema.parse(request.body);

    // 1. Build canonical payload (sorted keys → deterministic JSON)
    const payload = {
      author:     body.author,
      detections: body.detections,
      estimate:   body.estimate,
      filePath:   body.filePath,
      projectId:  body.projectId,
      timestamp:  body.timestamp,
    };
    const canonical = canonicalize(payload);

    // 2. SHA-256 hash
    const hash = createHash('sha256').update(canonical).digest('hex');

    // 3. Insert into DB first (get the UUID)
    const [row] = await db.insert(auditReports).values({
      projectId:  body.projectId,
      filePath:   body.filePath,
      author:     body.author,
      reportJson: payload as any,
      hash,
      txHash:     'pending',
      explorerUrl: '',
      anchored:   false,
    }).returning({ id: auditReports.id });

    const reportId = row.id;

    // 4. Anchor on-chain (async — soft failure)
    const { txHash, explorerUrl, anchored } = await storeHash(reportId, hash, 'report');

    // 5. Update row with tx result
    await db.update(auditReports)
      .set({ txHash, explorerUrl, anchored })
      .where(eq(auditReports.id, reportId));

    request.log.info({ reportId, hash: hash.slice(0, 16) + '…', anchored }, 'Cost report anchored');

    return reply.code(201).send({
      reportId,
      hash,
      txHash,
      explorerUrl,
      anchored,
    });
  });

  // ── GET /report ───────────────────────────────────────────────────────────
  fastify.get('/report', async (_request, reply) => {
    const rows = await db.select().from(auditReports)
      .orderBy(desc(auditReports.createdAt))
      .limit(20);

    return reply.send(rows.map(r => ({
      id:          r.id,
      projectId:   r.projectId,
      filePath:    r.filePath,
      author:      r.author,
      hash:        r.hash,
      txHash:      r.txHash,
      explorerUrl: r.explorerUrl,
      anchored:    r.anchored,
      createdAt:   r.createdAt,
    })));
  });

  // ── GET /verify/:reportId ─────────────────────────────────────────────────
  fastify.get<{ Params: { reportId: string } }>(
    '/verify/:reportId',
    async (request, reply) => {
      const { reportId } = request.params;

      // 1. Fetch from DB
      const rows = await db.select().from(auditReports)
        .where(eq(auditReports.id, reportId))
        .limit(1);

      if (!rows.length) {
        return reply.code(404).send({ error: 'Report not found', reportId });
      }

      const row = rows[0];

      // 2. Recompute hash from stored JSON
      const recomputed = createHash('sha256')
        .update(canonicalize(row.reportJson))
        .digest('hex');

      // 3. Fetch on-chain record (may be null if blockchain disabled)
      const onChainRecord = await getOnChainRecord(reportId);
      const onChain       = onChainRecord?.hash ?? null;

      // 4. Compare
      const dbMatch      = recomputed === row.hash;
      const chainMatch   = onChain ? onChain === row.hash : null; // null = not verifiable
      const authentic    = dbMatch && (chainMatch !== false);
      const divergence   = !dbMatch
        ? `DB hash mismatch — stored: ${row.hash.slice(0,16)}… recomputed: ${recomputed.slice(0,16)}…`
        : chainMatch === false
          ? `On-chain hash mismatch — chain: ${onChain!.slice(0,16)}… DB: ${row.hash.slice(0,16)}…`
          : null;

      return reply.send({
        authentic,
        recomputed,
        stored:     row.hash,
        onChain,
        chainMatch,
        divergence,
        txHash:      row.txHash,
        explorerUrl: row.explorerUrl,
        anchored:    row.anchored,
        createdAt:   row.createdAt,
      });
    },
  );
};
