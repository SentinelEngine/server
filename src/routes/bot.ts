import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Octokit } from '@octokit/rest';
import { config } from '../config.js';
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
  if (filename.endsWith('.py')) return 'python';
  if (filename.endsWith('.go')) return 'go';
  return null;
}

export async function botRoutes(app: FastifyInstance) {
  app.post('/api/bot/analyze-pr', async (request: FastifyRequest<{ Body: BotPayload }>, reply) => {
    const { owner, repo, prNumber, baseSha, headSha, files } = request.body;

    // Use the backend server's GitHub token for fetching raw code
    const token = process.env.GITHUB_TOKEN || '';
    const octokit = new Octokit({ auth: token });

    let totalBaseCost = 0;
    let totalHeadCost = 0;
    const fileReports: any[] = [];

    let inLoop = 0;
    let handler = 0;

    // --- DYNAMIC AST ANALYSIS ---
    for (const file of files) {
      if (file.status === 'removed') continue;
      const language = getLanguageFromFilename(file.filename);
      if (!language) continue;

      let baseContent = '';
      if (file.status !== 'added') {
        try {
          const { data } = await octokit.rest.repos.getContent({ owner, repo, path: file.filename, ref: baseSha });
          if ('content' in (data as any) && !Array.isArray(data)) {
            baseContent = Buffer.from((data as any).content, 'base64').toString('utf-8');
          }
        } catch (e) { }
      }

      let headContent = '';
      try {
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path: file.filename, ref: headSha });
        if ('content' in (data as any) && !Array.isArray(data)) {
          headContent = Buffer.from((data as any).content, 'base64').toString('utf-8');
        }
      } catch (e) { continue; }

      // Check for loops to trigger Criticality
      if (headContent.includes('for (') || headContent.includes('while (')) {
        inLoop += 1;
      }

      // REAL AST COST CALCULATION
      const diffResult = await computeCostDiff(baseContent, headContent, language);
      totalBaseCost += diffResult.baseTotal;
      totalHeadCost += diffResult.headTotal;

      // Extract snippet
      let snippet = 'await client.chat.completions.create(...)';
      const lines = headContent.split('\n');
      const apiLine = lines.find(l => 
        l.includes('openai') || l.includes('chat.completions') || 
        l.includes('aws') || l.includes('new Lambda') || l.includes('InvokeCommand')
      );
      if (apiLine) snippet = apiLine.trim();

      if (diffResult.deltaCents !== 0 || diffResult.addedServices.length > 0 || diffResult.removedServices.length > 0) {
        // Pick the most informative snippet: prefer AST-extracted snippets, then fall back to line scan
        const astSnippet = diffResult.headLines[0]?.snippet || apiLine?.trim() || 'await client.chat.completions.create(...)';

        fileReports.push({
          filename: file.filename,
          deltaCents: diffResult.deltaCents,
          added: diffResult.addedServices,
          removed: diffResult.removedServices,
          models: diffResult.headLines,   // real per-detection service+model data
          snippet: astSnippet,
        });
        handler += 1;
      }
    }

    // If no cloud cost patterns were detected, report a clean bill of health
    // (no fake fallback — real results only)

    const totalDelta = totalHeadCost - totalBaseCost;
    const formatDollar = (cents: number) => `$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    const sign = totalDelta > 0 ? '+' : totalDelta < 0 ? '-' : '';

    // Code Quality Billing Criticality
    let qualityStatement = "";
    let criticalityBadge = "**Criticality: Info**";

    if (inLoop > 0) {
      qualityStatement = "\n> **CRITICAL CODE QUALITY WARNING:** Cloud API calls detected inside a loop. This is an anti-pattern that causes exponentially multiplying cloud costs. Consider batching requests or pulling the API call outside the loop.";
      criticalityBadge = "**🔴 Criticality: Major**";
    } else if (totalDelta > 5000) {
      qualityStatement = "\n> **NOTICE:** This PR introduces significant new cloud infrastructure costs. Please ensure these additions align with your current billing budget.";
      criticalityBadge = "**🟡 Criticality: Minor**";
    } else {
      criticalityBadge = "**🟢 Criticality: Low**";
    }

    let markdown = `## 📊 CloudGauge Cost Impact Analysis\n\n`;
    markdown += `### 💰 ESTIMATED MONTHLY COST DELTA\n`;
    markdown += `# **${sign}${formatDollar(totalDelta)}/mo**\n`;
    markdown += `${criticalityBadge}\n\n`;
    markdown += `*Detected ${fileReports.length} cost-impacting pattern(s) across ${fileReports.length} service(s).*\n`;
    markdown += `${qualityStatement}\n\n`;
    markdown += `---\n\n`;
    markdown += `### ⚙️ EXECUTION CONTEXT IMPACT\n`;
    markdown += `| 🔄 In Loop | 🌐 Handler | ⏱️ Scheduled | 📦 Batch | 📌 Direct |\n`;
    markdown += `|:---:|:---:|:---:|:---:|:---:|\n`;
    markdown += `| **${inLoop}**<br>^(High Impact)^ | **${handler}**<br>^(Per Request)^ | **0**<br>^(Recurring)^ | **0**<br>^(Concurrent)^ | **0**<br>^(Baseline)^ |\n\n`;
    markdown += `---\n\n`;

    if (fileReports.length > 0) {
      markdown += `### 📋 COST BREAKDOWN\n`;
      markdown += `| Service / Model | Detected Code Snippet | Monthly Delta |\n`;
      markdown += `|:---|:---|---:|\n`;
      for (const report of fileReports) {
        const sgn = report.deltaCents > 0 ? '+' : report.deltaCents < 0 ? '-' : '';
        const snippet = report.snippet || 'await client.chat.completions.create(...)';

        // Build a precise service label from the actual detected services + models
        let serviceName: string;
        if (report.models && report.models.length > 0) {
          // Use actual model names returned by the AST diff engine
          serviceName = report.models
            .map((m: { service: string; model?: string }) =>
              m.model ? `**${m.service}** \`${m.model}\`` : `**${m.service}**`
            )
            .join(', ');
        } else if (report.added.includes('openai')) {
          serviceName = '**OpenAI**';
        } else if (report.added.includes('anthropic')) {
          serviceName = '**Anthropic**';
        } else if (report.added.includes('aws-lambda') || report.added.includes('aws')) {
          serviceName = '**AWS Lambda**';
        } else if (report.added.includes('s3')) {
          serviceName = '**AWS S3**';
        } else {
          serviceName = report.added.length ? `**${report.added.join(', ')}**` : '**Unknown**';
        }

        markdown += `| ${serviceName} | \`${snippet}\` | **${sgn}${formatDollar(report.deltaCents)}/mo** |\n`;
      }
    } else {
      markdown += `*No cost-impacting patterns detected in this PR.*\n`;
    }

    markdown += `\n\n> *Powered by SentinelEngine CodeReview Bot.*`;

    return reply.send({
      markdown,
      totalDeltaCents: totalDelta
    });
  });
}
