import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { analyzeCode }        from '../services/analyzer/index.js';
import { estimateCosts }      from '../services/analyzer/estimator.js';
import { enqueueAnalysis }    from '../services/jobs/analysis-queue.js';
import { computeCostDiff }    from '../services/diff/cost-diff.js';
import { db }                 from '../db/index.js';
import { analyses, costDiffs } from '../db/schema.js';
import { config }             from '../config.js';


const BodySchema = z.object({
  code:     z.string().min(1).max(config.MAX_FILE_SIZE_KB * 1024),
  language: z.enum(['typescript', 'javascript', 'python', 'go']).default('typescript'),
  fileName: z.string().max(255).default('untitled'),
});

const DiffBodySchema = z.object({
  baseCode: z.string().min(1).max(config.MAX_FILE_SIZE_KB * 1024),
  headCode: z.string().min(1).max(config.MAX_FILE_SIZE_KB * 1024),
  language: z.enum(['typescript', 'javascript', 'python', 'go']).default('typescript'),
  prNumber: z.number().int().positive().optional(),
});

export const analyzeRoutes: FastifyPluginAsync = async (fastify) => {

  // ── POST /analyze ─────────────────────────────────────────────────────────
  fastify.post('/analyze', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const body   = BodySchema.parse(request.body);
    const userId = (request.user as any).sub as string;

    const { language, detections, errors } = analyzeCode(body.code, body.language);
    if (errors.length) request.log.warn({ errors }, 'Analysis warnings');

    const report   = await estimateCosts(detections);
    const codeHash = createHash('sha256').update(body.code).digest('hex');

    const [row] = await db.insert(analyses).values({
      userId,
      fileName:     body.fileName,
      language,
      codeHash,
      detections:   detections as any,
      totalMonthly: report.totalMonthlyCents,
      breakdown:    report as any,
    }).returning({ id: analyses.id });

    return reply.send({ analysisId: row.id, report, detections, warnings: errors });
  });

  // ── POST /analyze/async ───────────────────────────────────────────────────
  // Enqueues an analysis job for long-running workloads
  fastify.post('/analyze/async', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const body   = BodySchema.parse(request.body);
    const userId = (request.user as any).sub as string;

    const jobId = await enqueueAnalysis({
      userId,
      code:     body.code,
      language: body.language,
      fileName: body.fileName,
    });

    return reply.code(202).send({ jobId, message: 'Analysis enqueued' });
  });

  // ── POST /analyze/diff ────────────────────────────────────────────────────
  fastify.post('/analyze/diff', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const body   = DiffBodySchema.parse(request.body);
    const userId = (request.user as any).sub as string;

    const diff = await computeCostDiff(body.baseCode, body.headCode, body.language);

    const baseHash = createHash('sha256').update(body.baseCode).digest('hex');
    const headHash = createHash('sha256').update(body.headCode).digest('hex');

    await db.insert(costDiffs).values({
      userId,
      prNumber:       body.prNumber ?? null,
      baseBranchHash: baseHash,
      headBranchHash: headHash,
      deltaMonthly:   diff.deltaCents,
      diffPayload:    diff as any,
    });

    return reply.send(diff);
  });

  // ── GET /analyze/stream (WebSocket) ───────────────────────────────────────
  // socket is a SocketStream; the raw ws instance is exposed as socket.socket
  fastify.get('/analyze/stream', { websocket: true }, async (socket, _request) => {
    const ws = socket.socket;

    ws.on('message', async (rawMsg: Buffer) => {
      let body: z.infer<typeof BodySchema>;
      try {
        body = BodySchema.parse(JSON.parse(rawMsg.toString()));
      } catch (err: any) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid payload: ' + err.message }));
        return;
      }

      // Step 1 — AST parsing
      ws.send(JSON.stringify({ type: 'status', message: 'Parsing AST…' }));
      const { detections, errors } = analyzeCode(body.code, body.language);
      ws.send(JSON.stringify({ type: 'detections', data: detections, errors }));

      if (!detections.length) {
        ws.send(JSON.stringify({
          type: 'complete',
          report: { totalMonthlyCents: 0, lines: [], currency: 'USD', generatedAt: new Date().toISOString() },
        }));
        return;
      }

      // Step 2 — Live pricing
      ws.send(JSON.stringify({ type: 'status', message: 'Fetching live pricing…' }));
      let report;
      try {
        report = await estimateCosts(detections);
      } catch (err: any) {
        ws.send(JSON.stringify({ type: 'error', message: 'Pricing fetch failed: ' + err.message }));
        return;
      }

      // Step 3 — Stream cost lines one by one (Monaco can show progressive updates)
      for (const line of report.lines) {
        ws.send(JSON.stringify({ type: 'costLine', data: line }));
        await new Promise(r => setTimeout(r, 20)); // 20 ms between frames
      }

      ws.send(JSON.stringify({ type: 'complete', report }));
    });

    ws.on('error', (err: Error) => {
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
    });
  });
};
