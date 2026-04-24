import { analyzeCode }   from '../analyzer/index.js';
import { estimateCosts } from '../analyzer/estimator.js';
import type { SupportedLanguage } from '../analyzer/types.js';

export interface CostDiffResult {
  baseTotal:       number;  // cents
  headTotal:       number;  // cents
  deltaCents:      number;  // positive = cost increased
  deltaPercent:    number;
  addedServices:   string[];
  removedServices: string[];
  addedModels:     string[];
  removedModels:   string[];
  /** Per-detection lines in the HEAD with service, model, and snippet info */
  headLines:       { service: string; model?: string; snippet: string; monthlyCents: number }[];
}

/**
 * Compute the cost difference between two versions of source code.
 * Typically used for PR review: baseCode = target branch, headCode = PR branch.
 */
export async function computeCostDiff(
  baseCode: string,
  headCode: string,
  language: string,
): Promise<CostDiffResult> {
  const lang = language as SupportedLanguage;

  const [baseA, headA] = await Promise.all([
    analyzeCode(baseCode, lang),
    analyzeCode(headCode, lang),
  ]);

  const [baseR, headR] = await Promise.all([
    estimateCosts(baseA.detections),
    estimateCosts(headA.detections),
  ]);

  const baseServices = new Set(baseR.lines.map(l => l.service));
  const headServices = new Set(headR.lines.map(l => l.service));

  const baseModels = new Set(
    baseR.lines.filter(l => l.model).map(l => `${l.service}:${l.model}`),
  );
  const headModels = new Set(
    headR.lines.filter(l => l.model).map(l => `${l.service}:${l.model}`),
  );

  const delta = headR.totalMonthlyCents - baseR.totalMonthlyCents;

  return {
    baseTotal:    baseR.totalMonthlyCents,
    headTotal:    headR.totalMonthlyCents,
    deltaCents:   delta,
    deltaPercent: baseR.totalMonthlyCents > 0
      ? Math.round((delta / baseR.totalMonthlyCents) * 10_000) / 100
      : headR.totalMonthlyCents > 0 ? 100 : 0,
    addedServices:   [...headServices].filter(s => !baseServices.has(s)),
    removedServices: [...baseServices].filter(s => !headServices.has(s)),
    addedModels:     [...headModels].filter(m => !baseModels.has(m)),
    removedModels:   [...baseModels].filter(m => !headModels.has(m)),
    headLines:       headR.lines.map(l => ({ service: l.service, model: l.model, snippet: l.snippet, monthlyCents: l.monthlyCents })),
  };
}
