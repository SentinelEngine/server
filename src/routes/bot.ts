import type { FastifyInstance, FastifyRequest } from 'fastify';
import { analyzeCode } from '../services/analyzer/index.js';

// ── Bot payload — bot now sends file content directly ────────────────────────
interface FileContent {
  filename:    string;
  status:      string;
  headContent: string;
  baseContent: string;
}

interface BotPayload {
  owner:        string;
  repo:         string;
  prNumber:     number;
  baseSha:      string;
  headSha:      string;
  fileContents: FileContent[];
}

function getLanguageFromFilename(filename: string): 'typescript' | 'javascript' | null {
  if (filename.endsWith('.ts') || filename.endsWith('.tsx')) return 'typescript';
  if (filename.endsWith('.js') || filename.endsWith('.jsx')) return 'javascript';
  return null;
}

// ── Inline pricing (no Redis / no HTTP dependency) ───────────────────────────
const OPENAI_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o':          { input: 0.005,   output: 0.015  },
  'gpt-4o-mini':     { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo':     { input: 0.01,    output: 0.03   },
  'gpt-4':           { input: 0.03,    output: 0.06   },
  'gpt-3.5-turbo':   { input: 0.0005,  output: 0.0015 },
};

const ANTHROPIC_PRICING: Record<string, { input: number; output: number }> = {
  'claude-3-5-sonnet': { input: 0.003,   output: 0.015   },
  'claude-3-opus':     { input: 0.015,   output: 0.075   },
  'claude-3-sonnet':   { input: 0.003,   output: 0.015   },
  'claude-3-haiku':    { input: 0.00025, output: 0.00125 },
  'claude-2':          { input: 0.008,   output: 0.024   },
};

function estimateCents(
  service: string, model: string | undefined,
  callsPerMonth: number, inputTokens: number, outputTokens: number,
  storageGB?: number, operation?: string,
): number {
  // Always resolve model to a known key — never let undefined skip the block
  if (service === 'openai') {
    const m = model && OPENAI_PRICING[model] ? model : 'gpt-4o';
    const p = OPENAI_PRICING[m];
    return Math.round(
      (inputTokens  / 1_000) * p.input  * callsPerMonth * 100 +
      (outputTokens / 1_000) * p.output * callsPerMonth * 100,
    );
  }
  if (service === 'anthropic') {
    const m = model && ANTHROPIC_PRICING[model] ? model : 'claude-3-5-sonnet';
    const p = ANTHROPIC_PRICING[m];
    return Math.round(
      (inputTokens  / 1_000) * p.input  * callsPerMonth * 100 +
      (outputTokens / 1_000) * p.output * callsPerMonth * 100,
    );
  }
  if (service === 'aws-lambda') {
    const gbSecs         = (128 / 1_024) * (200 / 1_000) * callsPerMonth;
    const billableReqs   = Math.max(0, callsPerMonth - 1_000_000);
    const billableGbSecs = Math.max(0, gbSecs - 400_000);
    return Math.round(billableReqs * 0.0000002 * 100 + billableGbSecs * 0.0000166667 * 100);
  }
  if (service === 's3') {
    const gb       = storageGB ?? 10;
    const isWrite  = operation === 'put';
    const storage  = Math.round(gb * 0.023 * 100);
    const requests = isWrite
      ? Math.round((callsPerMonth / 1_000) * 0.005  * 100)
      : Math.round((callsPerMonth / 1_000) * 0.0004 * 100);
    return storage + requests;
  }
  if (service === 'dynamodb') {
    const perUnit = operation === 'write' ? 0.00000125 : 0.00000025;
    return Math.round(callsPerMonth * perUnit * 100);
  }
  if (service === 'api-gateway') return Math.round((callsPerMonth / 1_000_000) * 3.5 * 100);
  if (service === 'redis')       return 1_224;
  return 0;
}

// ── Route ────────────────────────────────────────────────────────────────────
export async function botRoutes(app: FastifyInstance) {
  app.post('/api/bot/analyze-pr', async (
    request: FastifyRequest<{ Body: BotPayload }>,
    reply,
  ) => {
    const { fileContents = [] } = request.body;

    let totalHeadCents = 0;
    let totalBaseCents = 0;
    let inLoop         = 0;
    let handler        = 0;

    interface DetectionRow {
      service:    string;
      model?:     string;
      snippet:    string;
      headCents:  number;
      deltaCents: number;
      inLoop:     boolean;
    }
    const detectionRows: DetectionRow[] = [];
    const debugLines:    string[]       = [];

    for (const file of fileContents) {
      const language = getLanguageFromFilename(file.filename);
      if (!language) {
        debugLines.push(`skip (not JS/TS): ${file.filename}`);
        continue;
      }

      const headContent = file.headContent ?? '';
      const baseContent = file.baseContent ?? '';

      if (!headContent.trim()) {
        debugLines.push(`empty head content: ${file.filename}`);
        continue;
      }

      debugLines.push(`analyzing: ${file.filename} (${headContent.length} chars, ${language})`);

      // ── AST analysis ────────────────────────────────────────────────────
      const headA = analyzeCode(headContent, language);
      const baseA = analyzeCode(baseContent, language);

      debugLines.push(`  detections head=${headA.detections.length} base=${baseA.detections.length}`);
      if (headA.errors.length) debugLines.push(`  AST errors: ${headA.errors.join('; ')}`);

      if (headA.detections.length === 0) continue;

      const fileHasLoop = /for\s*\(|while\s*\(|\.forEach\s*\(|\.map\s*\(/.test(headContent);
      if (fileHasLoop) inLoop += 1;
      handler += 1;

      // ── Cost calculation ─────────────────────────────────────────────────
      let fileHeadCents = 0;
      let fileBaseCents = 0;

      for (const d of headA.detections) {
        const cents = estimateCents(
          d.service, d.model,
          d.callsPerMonth ?? 10_000,
          d.inputTokens   ?? 500,
          d.outputTokens  ?? 1_000,
          d.storageGB, d.operation,
        );
        fileHeadCents += cents;
        debugLines.push(`  [${d.service}] model=${d.model ?? 'undefined'} calls=${d.callsPerMonth ?? 10_000} → $${(cents/100).toFixed(2)}/mo`);
        detectionRows.push({
          service:    d.service,
          model:      d.model,
          snippet:    d.snippet,
          headCents:  cents,
          deltaCents: 0,          // filled below
          inLoop:     fileHasLoop,
        });
      }

      for (const d of baseA.detections) {
        fileBaseCents += estimateCents(
          d.service, d.model,
          d.callsPerMonth ?? 10_000,
          d.inputTokens   ?? 500,
          d.outputTokens  ?? 1_000,
          d.storageGB, d.operation,
        );
      }

      totalHeadCents += fileHeadCents;
      totalBaseCents += fileBaseCents;

      // Distribute file delta proportionally across detections
      const fileDelta = fileHeadCents - fileBaseCents;
      const startIdx  = detectionRows.length - headA.detections.length;
      for (let i = startIdx; i < detectionRows.length; i++) {
        const share = fileHeadCents > 0 ? detectionRows[i].headCents / fileHeadCents : 0;
        detectionRows[i].deltaCents = Math.round(fileDelta * share);
      }
    }

    // ── Build markdown ────────────────────────────────────────────────────────
    const totalDelta     = totalHeadCents - totalBaseCents;
    const fmt            = (c: number) => `$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    const sign           = (c: number) => c > 0 ? '+' : c < 0 ? '-' : '';
    const uniqueServices = [...new Set(detectionRows.map(r => r.service))];

    let critBadge   = '🟢 **Criticality: Low**';
    let qualityNote = '';
    if (inLoop > 0) {
      critBadge   = '🔴 **Criticality: Major**';
      qualityNote = '\n> ⚠️ **CRITICAL:** Cloud API calls inside a loop — costs scale with every iteration. Consider batching.\n';
    } else if (totalHeadCents > 5_000) {
      critBadge   = '🟡 **Criticality: Minor**';
      qualityNote = '\n> 💡 Significant cloud costs detected. Verify these align with your budget.\n';
    }

    let md = `## 📊 CloudGauge Cost Impact Analysis\n\n`;
    md    += `### 💰 ESTIMATED MONTHLY COST DELTA\n`;
    md    += `# **${sign(totalDelta)}${fmt(totalDelta)}/mo**\n`;
    md    += `${critBadge}\n\n`;
    md    += `> Total cloud cost **in changed files**: **${fmt(totalHeadCents)}/mo**`;
    if (totalBaseCents > 0) md += ` *(was ${fmt(totalBaseCents)}/mo before this PR)*`;
    md    += `\n\n`;
    md    += `*Detected **${detectionRows.length}** cloud API call(s) across **${uniqueServices.length}** service(s).*\n`;
    md    += qualityNote + '\n';
    md    += `---\n\n`;

    md += `### ⚙️ EXECUTION CONTEXT IMPACT\n`;
    md += `| 🔄 In Loop | 🌐 Handler | ⏱️ Scheduled | 📦 Batch | 📌 Direct |\n`;
    md += `|:---:|:---:|:---:|:---:|:---:|\n`;
    md += `| **${inLoop}**<br>^(High Impact)^ | **${handler}**<br>^(Per Request)^ | **0**<br>^(Recurring)^ | **0**<br>^(Concurrent)^ | **0**<br>^(Baseline)^ |\n\n`;
    md += `---\n\n`;

    if (detectionRows.length > 0) {
      md += `### 📋 COST BREAKDOWN\n`;
      md += `| Service / Model | Detected Snippet | Est. Cost/mo | PR Delta |\n`;
      md += `|:---|:---|---:|---:|\n`;
      for (const row of detectionRows) {
        const label = row.model ? `**${row.service}** \`${row.model}\`` : `**${row.service}**`;
        const badge = row.inLoop ? ' 🔄' : '';
        const delta = row.deltaCents !== 0
          ? `**${sign(row.deltaCents)}${fmt(row.deltaCents)}/mo**`
          : `*(existing)*`;
        md += `| ${label}${badge} | \`${row.snippet.slice(0, 70)}\` | **${fmt(row.headCents)}/mo** | ${delta} |\n`;
      }
    } else {
      md += `*No cloud API calls detected in the changed files.*\n`;
    }

    // Always show debug info to help diagnose issues
    if (debugLines.length > 0) {
      md += `\n<details><summary>🔍 Debug Info</summary>\n\n\`\`\`\n${debugLines.join('\n')}\n\`\`\`\n</details>\n`;
    }

    md += `\n\n> *Powered by SentinelEngine CodeReview Bot.*`;

    return reply.send({ markdown: md, totalDeltaCents: totalDelta });
  });
}
