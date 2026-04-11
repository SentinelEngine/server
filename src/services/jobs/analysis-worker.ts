import { Worker } from 'bullmq';
import { createHash } from 'node:crypto';
import { getRedis }      from '../pricing/cache.js';
import { analyzeCode }   from '../analyzer/index.js';
import { estimateCosts } from '../analyzer/estimator.js';
import { db }            from '../../db/index.js';
import { analyses }      from '../../db/schema.js';
import type { AnalysisJobData, AnalysisJobResult } from './analysis-queue.js';

export const analysisWorker = new Worker<AnalysisJobData, AnalysisJobResult>(
  'analysis',
  async (job) => {
    const { userId, code, language, fileName } = job.data;

    await job.updateProgress(10);

    const { detections, errors } = analyzeCode(code, language as any);
    if (errors.length) {
      await job.log(`Warnings during analysis: ${errors.join(', ')}`);
    }

    await job.updateProgress(50);

    const report   = await estimateCosts(detections);
    const codeHash = createHash('sha256').update(code).digest('hex');

    await job.updateProgress(80);

    const [row] = await db.insert(analyses).values({
      userId,
      fileName,
      language,
      codeHash,
      detections:   detections as any,
      totalMonthly: report.totalMonthlyCents,
      breakdown:    report as any,
    }).returning({ id: analyses.id });

    await job.updateProgress(100);

    return {
      totalMonthlyCents: report.totalMonthlyCents,
      analysisId:        row.id,
    };
  },
  {
    connection:  getRedis(),
    concurrency: 5,
  },
);

analysisWorker.on('completed', (job, result) => {
  console.log(`[worker] Job ${job.id} completed — $${(result.totalMonthlyCents / 100).toFixed(2)}/mo`);
});

analysisWorker.on('failed', (job, err) => {
  console.error(`[worker] Job ${job?.id} failed:`, err);
});

analysisWorker.on('error', (err) => {
  console.error('[worker] Worker error:', err);
});
