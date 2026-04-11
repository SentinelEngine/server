import { Queue } from 'bullmq';
import { getRedis } from '../pricing/cache.js';

export interface AnalysisJobData {
  userId:   string;
  code:     string;
  language: string;
  fileName: string;
}

export interface AnalysisJobResult {
  totalMonthlyCents: number;
  analysisId: string;
}

export const analysisQueue = new Queue<AnalysisJobData, AnalysisJobResult>('analysis', {
  connection: getRedis(),
  defaultJobOptions: {
    attempts:          3,
    backoff:           { type: 'exponential', delay: 1_000 },
    removeOnComplete:  100,
    removeOnFail:      200,
  },
});

/**
 * Enqueue a new analysis job and return the BullMQ job ID.
 */
export async function enqueueAnalysis(data: AnalysisJobData): Promise<string> {
  const job = await analysisQueue.add('analyze', data);
  return job.id!;
}
