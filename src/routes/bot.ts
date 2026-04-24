import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Octokit } from '@octokit/rest';
import { analyzeCode } from '../services/analyzer/index.js';

interface BotPayload {
  owner: string;
  repo: string;
  prNumber: number;
  baseSha: string;
  headSha: string;
  files: { filename: string; status: string }[];
}

function getLanguageFromFilename(filename: string): 'typescript' | 'javascript' | null {
  if (filename.endsWith('.ts') || filename.endsWith('.tsx')) return 'typescript';
  if (filename.endsWith('.js') || filename.endsWith('.jsx')) return 'javascript';
  return null;
}

// ── Inline pricing (no Redis dependency) ─────────────────────────────────────
const OPENAI_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o':              { input: 0.005,   output: 0.015  },
  'gpt-4o-mini':         { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo':         { input: 0.01,    output: 0.03   },
  'gpt-4':               { input: 0.03,    output: 0.06   },
  'gpt-3.5-turbo':       { input: 0.0005,  output: 0.0015 },
};

const ANTHROPIC_PRICING: Record<string, { input: number; output: number }> = {
  'claude-3-5-sonnet':   { input: 0.003,   output: 0.015  },
  'claude-3-opus':       { input: 0.015,   output: 0.075  },
  'claude-3-sonnet':     { input: 0.003,   output: 0.015  },
  'claude-3-haiku':      { input: 0.00025, output: 0.00125 },
  'claude-2':            { input: 0.008,   output: 0.024  },
};

function estimateCentsInline(service: string, model: string | undefined, callsPerMonth: number,
                              inputTokens: number, outputTokens: number,
                              storageGB?: number, operation?: string): number {
  if (service === 'openai' && model) {
    const p = OPENAI_PRICING[model] ?? OPENAI_PRICING['gpt-4o'];
    return Math.round(
      ((inputTokens  / 1_000) * p.input  * callsPerMonth * 100) +
      ((outputTokens / 1_000) * p.output * callsPerMonth * 100)
    );
  }
  if (service === 'anthropic' && model) {
    const p = ANTHROPIC_PRICING[model] ?? ANTHROPIC_PRICING['claude-3-5-sonnet'];
    return Math.round(
      ((inputTokens  / 1_000) * p.input  * callsPerMonth * 100) +
      ((outputTokens / 1_000) * p.output * callsPerMonth * 100)
    );
  }
  if (service === 'aws-lambda') {
    const calls   = callsPerMonth;
    const memMB   = 128;
    const durMs   = 200;
    const gbSecs  = (memMB / 1_024) * (durMs / 1_000) * calls;
    const billableReqs   = Math.max(0, calls - 1_000_000);
    const billableGbSecs = Math.max(0, gbSecs - 400_000);
    return Math.round(billableReqs * 0.0000002 * 100 + billableGbSecs * 0.0000166667 * 100);
  }
  if (service === 's3') {
    const gb       = storageGB ?? 10;
    const isWrite  = operation === 'put';
    const storage  = Math.round(gb * 0.023 * 100);
    const requests = isWrite
      ? Math.round((callsPerMonth / 1_000) * 0.005 * 100)
      : Math.round((callsPerMonth / 1_000) * 0.0004 * 100);
    return storage + requests;
  }
  if (service === 'dynamodb') {
    const perUnit = operation === 'write' ? 0.00000125 : 0.00000025;
    return Math.round(callsPerMonth * perUnit * 100);
  }
  if (service === 'api-gateway') {
    return Math.round((callsPerMonth / 1_000_000) * 3.5 * 100);
  }
  if (service === 'redis') return 1_224; // cache.t3.micro baseline
  return 0;
}

// ── Route ─────────────────────────────────────────────────────────────────────
export async function botRoutes(app: FastifyInstance) {
  app.post('/api/bot/analyze-pr', async (request: FastifyRequest<{ Body: BotPayload }>, reply) => {
    const { owner, repo, baseSha, headSha, files } = request.body;

    const token  = process.env.GITHUB_TOKEN || '';
    const octokit = new Octokit({ auth: token });

    let totalHeadCents = 0;
    let totalBaseCents = 0;
    let inLoop         = 0;
    let handler        = 0;
    const fetchErrors: string[] = [];
    const debugLines:  string[] = [];

    interface DetectionRow {
      service:    string;
      model?:     string;
      snippet:    string;
      headCents:  number;
      deltaCents: number;
      inLoop:     boolean;
    }
    const detectionRows: DetectionRow[] = [];

    for (const file of files) {
      if (file.status === 'removed') continue;
      const language = getLanguageFromFilename(file.filename);
      if (!language) {
        debugLines.push(`skip (not JS/TS): ${file.filename}`);
        continue;
      }

      // ── Fetch HEAD ─────────────────────────────────────────────────────────
      let headContent = '';
      try {
        const { data } = await octokit.rest.repos.getContent({
          owner, repo, path: file.filename, ref: headSha,
        });
        if ('content' in (data as any) && !Array.isArray(data)) {
          headContent = Buffer.from((data as any).content, 'base64').toString('utf-8');
        }
      } catch (e: any) {
        fetchErrors.push(`HEAD fetch failed for ${file.filename}: ${e.message}`);
        debugLines.push(`HEAD fetch error ${file.filename}: ${e.message}`);
        continue;
      }

      if (!headContent.trim()) {
        debugLines.push(`HEAD content empty for ${file.filename}`);
        continue;
      }

      // ── Fetch BASE ─────────────────────────────────────────────────────────
      let baseContent = '';
      if (file.status !== 'added') {
        try {
          const { data } = await octokit.rest.repos.getContent({
            owner, repo, path: file.filename, ref: baseSha,
          });
          if ('content' in (data as any) && !Array.isArray(data)) {
            baseContent = Buffer.from((data as any).content, 'base64').toString('utf-8');
          }
        } catch { /* treat as new file */ }
      }

      debugLines.push(`analyzing ${file.filename} (${headContent.length} chars, lang=${language})`);

      // ── AST analysis ───────────────────────────────────────────────────────
      const headAnalysis = analyzeCode(headContent, language);
      const baseAnalysis = analyzeCode(baseContent || '', language);

      debugLines.push(`  head detections: ${headAnalysis.detections.length}`);
      if (headAnalysis.errors.length) debugLines.push(`  AST errors: ${headAnalysis.errors.join('; ')}`);

      if (headAnalysis.detections.length === 0) continue;

      const fileHasLoop = /for\s*\(|while\s*\(|\.forEach\s*\(|\.map\s*\(/.test(headContent);
      if (fileHasLoop) inLoop += 1;
      handler += 1;

      // ── Compute costs inline (no Redis) ────────────────────────────────────
      let fileHeadCents = 0;
      let fileBaseCents = 0;

      for (const d of headAnalysis.detections) {
        const cents = estimateCentsInline(
          d.service, d.model, d.callsPerMonth ?? 10_000,
          d.inputTokens ?? 500, d.outputTokens ?? 1_000,
          d.storageGB, d.operation,
        );
        fileHeadCents += cents;

        detectionRows.push({
          service:   d.service,
          model:     d.model,
          snippet:   d.snippet,
          headCents: cents,
          deltaCents: 0, // filled in below
          inLoop:    fileHasLoop,
        });
      }

      for (const d of baseAnalysis.detections) {
        fileBaseCents += estimateCentsInline(
          d.service, d.model, d.callsPerMonth ?? 10_000,
          d.inputTokens ?? 500, d.outputTokens ?? 1_000,
          d.storageGB, d.operation,
        );
      }

      totalHeadCents += fileHeadCents;
      totalBaseCents += fileBaseCents;

      // Distribute delta proportionally across detections in this file
      const fileDelta = fileHeadCents - fileBaseCents;
      const startIdx  = detectionRows.length - headAnalysis.detections.length;
      for (let i = startIdx; i < detectionRows.length; i++) {
        const share = fileHeadCents > 0 ? detectionRows[i].headCents / fileHeadCents : 0;
        detectionRows[i].deltaCents = Math.round(fileDelta * share);
      }
    }

    // ── Build markdown ────────────────────────────────────────────────────────
    const totalDelta   = totalHeadCents - totalBaseCents;
    const fmt          = (c: number) => `$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    const sign         = (c: number) => c > 0 ? '+' : c < 0 ? '-' : '';
    const uniqueServices = [...new Set(detectionRows.map(r => r.service))];

    let criticalityBadge = '🟢 **Criticality: Low**';
    let qualityStatement = '';
    if (inLoop > 0) {
      criticalityBadge = '🔴 **Criticality: Major**';
      qualityStatement = '\n> ⚠️ **CRITICAL:** Cloud API calls detected inside a loop. Costs scale with every iteration — consider batching.\n';
    } else if (totalHeadCents > 5_000) {
      criticalityBadge = '🟡 **Criticality: Minor**';
      qualityStatement = '\n> 💡 Significant cloud costs detected. Ensure these align with your budget.\n';
    }

    let md = `## 📊 CloudGauge Cost Impact Analysis\n\n`;
    md += `### 💰 ESTIMATED MONTHLY COST DELTA\n`;
    md += `# **${sign(totalDelta)}${fmt(totalDelta)}/mo**\n`;
    md += `${criticalityBadge}\n\n`;
    md += `> Total cloud cost **in changed files**: **${fmt(totalHeadCents)}/mo**`;
    if (totalBaseCents > 0) md += ` *(was ${fmt(totalBaseCents)}/mo before this PR)*`;
    md += `\n\n`;
    md += `*Detected **${detectionRows.length}** cloud API call(s) across **${uniqueServices.length}** service(s).*\n`;
    md += qualityStatement + '\n';
    md += `---\n\n`;

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
        const delta = row.deltaCents !== 0 ? `**${sign(row.deltaCents)}${fmt(row.deltaCents)}/mo**` : `*(existing)*`;
        md += `| ${label}${badge} | \`${row.snippet.slice(0, 70)}\` | **${fmt(row.headCents)}/mo** | ${delta} |\n`;
      }
    } else {
      md += `*No cloud API calls detected in the changed files.*\n`;
      if (fetchErrors.length > 0) {
        md += `\n> ⚠️ **File fetch errors** (check GITHUB\\_TOKEN permissions):\n`;
        for (const e of fetchErrors) md += `> - \`${e}\`\n`;
      }
      if (debugLines.length > 0) {
        md += `\n<details><summary>🔍 Debug Info</summary>\n\n\`\`\`\n${debugLines.join('\n')}\n\`\`\`\n</details>\n`;
      }
    }

    md += `\n\n> *Powered by SentinelEngine CodeReview Bot.*`;

    return reply.send({ markdown: md, totalDeltaCents: totalDelta });
  });
}
