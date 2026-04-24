import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Octokit } from '@octokit/rest';
import { computeCostDiff } from '../services/diff/cost-diff.js';

interface BotPayload {
  owner: string;
  repo: string;
  prNumber: number;
  baseSha: string;
  headSha: string;
  files: { filename: string; status: string }[];
}

function getLanguageFromFilename(filename: string): string | null {
  if (filename.endsWith('.ts') || filename.endsWith('.tsx')) return 'typescript';
  if (filename.endsWith('.js') || filename.endsWith('.jsx')) return 'javascript';
  return null;
}

export async function botRoutes(app: FastifyInstance) {
  app.post('/api/bot/analyze-pr', async (request: FastifyRequest<{ Body: BotPayload }>, reply) => {
    const { owner, repo, baseSha, headSha, files } = request.body;

    const token = process.env.GITHUB_TOKEN || '';
    const octokit = new Octokit({ auth: token });

    let totalBaseCost  = 0;
    let totalHeadCost  = 0;
    let inLoop         = 0;
    let handler        = 0;
    const fetchErrors: string[] = [];

    // Per-detection breakdown rows: one row per AST detection in HEAD
    interface DetectionRow {
      service:      string;
      model?:       string;
      snippet:      string;
      headCents:    number;  // absolute monthly cost in HEAD
      deltaCents:   number;  // change introduced by this PR
      inLoop:       boolean;
    }
    const detectionRows: DetectionRow[] = [];

    // --- DYNAMIC AST ANALYSIS ---
    for (const file of files) {
      if (file.status === 'removed') continue;
      const language = getLanguageFromFilename(file.filename);
      if (!language) continue;

      // Fetch BASE content (what was there before the PR)
      let baseContent = '';
      if (file.status !== 'added') {
        try {
          const { data } = await octokit.rest.repos.getContent({ owner, repo, path: file.filename, ref: baseSha });
          if ('content' in (data as any) && !Array.isArray(data)) {
            baseContent = Buffer.from((data as any).content, 'base64').toString('utf-8');
          }
        } catch (e: any) {
          // Non-fatal: treat as empty (new file scenario)
          fetchErrors.push(`[base] ${file.filename}: ${e.message}`);
        }
      }

      // Fetch HEAD content (what the PR introduces)
      let headContent = '';
      try {
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path: file.filename, ref: headSha });
        if ('content' in (data as any) && !Array.isArray(data)) {
          headContent = Buffer.from((data as any).content, 'base64').toString('utf-8');
        }
      } catch (e: any) {
        fetchErrors.push(`[head] ${file.filename}: ${e.message}`);
        continue; // Cannot analyze — skip this file
      }

      if (!headContent.trim()) continue;

      // Detect loop patterns in head file
      const fileHasLoop = /for\s*\(|while\s*\(|\.forEach\s*\(|\.map\s*\(/.test(headContent);
      if (fileHasLoop) inLoop += 1;

      // Run AST cost diff
      const diffResult = await computeCostDiff(baseContent, headContent, language);
      totalBaseCost += diffResult.baseTotal;
      totalHeadCost += diffResult.headTotal;

      // ── Key fix: Report ALL detections in HEAD (not just services that changed) ──
      // headLines contains every cloud API call found in the PR's version of the file.
      if (diffResult.headLines.length > 0) {
        handler += 1;

        // Compute per-detection cost delta: headCents proportional share of total delta
        const totalHeadFile  = diffResult.headTotal  || 1;
        const fileDelta      = diffResult.deltaCents;

        for (const line of diffResult.headLines) {
          const share      = line.monthlyCents / totalHeadFile;
          const lineDelta  = Math.round(fileDelta * share);

          detectionRows.push({
            service:   line.service,
            model:     line.model,
            snippet:   line.snippet,
            headCents: line.monthlyCents,
            deltaCents: lineDelta,
            inLoop:    fileHasLoop,
          });
        }
      }
    }

    // ── Build markdown report ──────────────────────────────────────────────────

    const totalDelta   = totalHeadCost - totalBaseCost;
    const fmt          = (cents: number) =>
      `$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    const sign         = (cents: number) => cents > 0 ? '+' : cents < 0 ? '-' : '';

    // Criticality
    let criticalityBadge  = '🟢 **Criticality: Low**';
    let qualityStatement  = '';

    if (inLoop > 0) {
      criticalityBadge = '🔴 **Criticality: Major**';
      qualityStatement = '\n> ⚠️ **CRITICAL:** Cloud API calls detected inside a loop — costs scale with every iteration. Consider batching or moving calls outside the loop.\n';
    } else if (totalHeadCost > 5_000) {
      criticalityBadge = '🟡 **Criticality: Minor**';
      qualityStatement = '\n> 💡 **NOTICE:** Significant cloud costs detected in changed files. Ensure these align with your budget.\n';
    }

    // Unique service count
    const uniqueServices = [...new Set(detectionRows.map(r => r.service))];

    let markdown = `## 📊 CloudGauge Cost Impact Analysis\n\n`;

    // ── Headline numbers ──
    markdown += `### 💰 ESTIMATED MONTHLY COST DELTA\n`;
    markdown += `# **${sign(totalDelta)}${fmt(totalDelta)}/mo**\n`;
    markdown += `${criticalityBadge}\n\n`;
    markdown += `> Total cloud cost **in changed files**: **${fmt(totalHeadCost)}/mo**`;
    if (totalBaseCost > 0) markdown += ` *(was ${fmt(totalBaseCost)}/mo before this PR)*`;
    markdown += `\n\n`;
    markdown += `*Detected **${detectionRows.length}** cloud API call(s) across **${uniqueServices.length}** service(s).*\n`;
    markdown += qualityStatement + '\n';
    markdown += `---\n\n`;

    // ── Execution context table ──
    markdown += `### ⚙️ EXECUTION CONTEXT IMPACT\n`;
    markdown += `| 🔄 In Loop | 🌐 Handler | ⏱️ Scheduled | 📦 Batch | 📌 Direct |\n`;
    markdown += `|:---:|:---:|:---:|:---:|:---:|\n`;
    markdown += `| **${inLoop}**<br>^(High Impact)^ | **${handler}**<br>^(Per Request)^ | **0**<br>^(Recurring)^ | **0**<br>^(Concurrent)^ | **0**<br>^(Baseline)^ |\n\n`;
    markdown += `---\n\n`;

    // ── Per-detection cost breakdown ──
    if (detectionRows.length > 0) {
      markdown += `### 📋 COST BREAKDOWN\n`;
      markdown += `| Service / Model | Detected Snippet | Est. Cost/mo | PR Delta |\n`;
      markdown += `|:---|:---|---:|---:|\n`;

      for (const row of detectionRows) {
        const serviceLabel = row.model
          ? `**${row.service}** \`${row.model}\``
          : `**${row.service}**`;
        const loopBadge  = row.inLoop ? ' 🔄' : '';
        const deltaStr   = row.deltaCents !== 0
          ? `**${sign(row.deltaCents)}${fmt(row.deltaCents)}/mo**`
          : `*(existing)*`;

        markdown += `| ${serviceLabel}${loopBadge} | \`${row.snippet.slice(0, 70)}\` | **${fmt(row.headCents)}/mo** | ${deltaStr} |\n`;
      }
    } else {
      markdown += `*No cloud API calls detected in the changed files.*\n`;

      // Surface fetch errors if that's why we got nothing
      if (fetchErrors.length > 0) {
        markdown += `\n> ⚠️ **Note:** Some files could not be fetched (GITHUB_TOKEN may lack repo read access):\n`;
        for (const e of fetchErrors) markdown += `> - \`${e}\`\n`;
      }
    }

    markdown += `\n\n> *Powered by SentinelEngine CodeReview Bot.*`;

    return reply.send({
      markdown,
      totalDeltaCents: totalDelta,
    });
  });
}
