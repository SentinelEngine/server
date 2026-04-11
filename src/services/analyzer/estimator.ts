import type { DetectionMatch } from './types.js';
import { fetchOpenAIPricing }    from '../pricing/providers/openai.js';
import { fetchAnthropicPricing } from '../pricing/providers/anthropic.js';
import { fetchAWSPricing }       from '../pricing/providers/aws.js';

export interface CostLine {
  service:      string;
  model?:       string;
  monthlyCents: number;
  breakdown:    Record<string, number>;
  line:         number;
  snippet:      string;
}

export interface CostReport {
  totalMonthlyCents: number;
  lines:             CostLine[];
  currency:          'USD';
  generatedAt:       string;
}

/**
 * Calculates monthly cost estimates for each detected cloud service usage.
 * Fetches live (or cached) pricing from all providers concurrently.
 */
export async function estimateCosts(detections: DetectionMatch[]): Promise<CostReport> {
  const [openai, anthropic, aws] = await Promise.all([
    fetchOpenAIPricing(),
    fetchAnthropicPricing(),
    fetchAWSPricing(),
  ]);

  const lines: CostLine[] = detections.map(d => {
    const breakdown: Record<string, number> = {};
    let monthlyCents = 0;

    // ── OpenAI ─────────────────────────────────────────────────────────────
    if (d.service === 'openai' && d.model) {
      const p = openai[d.model];
      if (p) {
        const calls = d.callsPerMonth ?? 10_000;
        const inTok = d.inputTokens ?? 500;
        const outTok = d.outputTokens ?? 1_000;

        breakdown.input  = Math.round((inTok  / 1_000) * p.inputPer1kTokens  * calls * 100);
        breakdown.output = Math.round((outTok / 1_000) * p.outputPer1kTokens * calls * 100);
        monthlyCents = breakdown.input + breakdown.output;
      }
    }

    // ── Anthropic ──────────────────────────────────────────────────────────
    if (d.service === 'anthropic' && d.model) {
      const p = anthropic[d.model];
      if (p) {
        const calls = d.callsPerMonth ?? 10_000;
        const inTok = d.inputTokens ?? 500;
        const outTok = d.outputTokens ?? 1_000;

        breakdown.input  = Math.round((inTok  / 1_000) * p.inputPer1kTokens  * calls * 100);
        breakdown.output = Math.round((outTok / 1_000) * p.outputPer1kTokens * calls * 100);
        monthlyCents = breakdown.input + breakdown.output;
      }
    }

    // ── AWS Lambda ─────────────────────────────────────────────────────────
    if (d.service === 'aws-lambda') {
      const p = aws.lambda;
      const calls   = d.callsPerMonth ?? 100_000;
      const memMB   = d.memoryMB    ?? 128;
      const durMs   = d.durationMs  ?? 200;
      const gbSecs  = (memMB / 1_024) * (durMs / 1_000) * calls;

      const billableRequests = Math.max(0, calls - p.freeRequests);
      const billableGbSecs   = Math.max(0, gbSecs - p.freeGbSeconds);

      breakdown.requests = Math.round(billableRequests * p.perRequest * 100);
      breakdown.compute  = Math.round(billableGbSecs   * p.perGbSecond * 100);
      monthlyCents = breakdown.requests + breakdown.compute;
    }

    // ── DynamoDB ───────────────────────────────────────────────────────────
    if (d.service === 'dynamodb') {
      const p = aws.dynamodb;
      const calls = d.callsPerMonth ?? 100_000;
      const isWrite = d.operation === 'write';

      if (isWrite) {
        breakdown.writes = Math.round(calls * p.perWriteUnit * 100);
        monthlyCents = breakdown.writes;
      } else {
        breakdown.reads = Math.round(calls * p.perReadUnit * 100);
        monthlyCents = breakdown.reads;
      }
    }

    // ── S3 ─────────────────────────────────────────────────────────────────
    if (d.service === 's3') {
      const p = aws.s3;
      const calls   = d.callsPerMonth ?? 100_000;
      const storage = d.storageGB    ?? 10;
      const isWrite = d.operation === 'put';

      breakdown.storage = Math.round(storage * p.perGbStorage * 100);
      breakdown.requests = isWrite
        ? Math.round((calls / 1_000) * p.perPutRequest * 100)
        : Math.round((calls / 1_000) * p.perGetRequest * 100);
      monthlyCents = breakdown.storage + breakdown.requests;
    }

    // ── API Gateway ────────────────────────────────────────────────────────
    if (d.service === 'api-gateway') {
      const p = aws.apiGateway;
      const calls = d.callsPerMonth ?? 1_000_000;

      breakdown.requests = Math.round((calls / 1_000_000) * p.perMillionRequests * 100);
      monthlyCents = breakdown.requests;
    }

    // ── Redis (ElastiCache) ────────────────────────────────────────────────
    // ElastiCache pricing is instance-based; we use a reasonable minimum tier
    if (d.service === 'redis') {
      // cache.t3.micro: ~$0.017/hr → ~$12.24/month
      breakdown.instance = 1_224;
      monthlyCents = breakdown.instance;
    }

    return {
      service:      d.service,
      model:        d.model,
      monthlyCents,
      breakdown,
      line:         d.line,
      snippet:      d.snippet,
    };
  });

  return {
    totalMonthlyCents: lines.reduce((sum, l) => sum + l.monthlyCents, 0),
    lines,
    currency:    'USD',
    generatedAt: new Date().toISOString(),
  };
}
