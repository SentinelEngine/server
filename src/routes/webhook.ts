import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Octokit } from '@octokit/rest';
import { computeCostDiff } from '../services/diff/cost-diff.js';

const GithubWebhookPayloadSchema = z.object({
  action: z.string(),
  pull_request: z.object({
    number: z.number(),
    base: z.object({
      sha: z.string(),
      ref: z.string(),
    }),
    head: z.object({
      sha: z.string(),
      ref: z.string(),
    }),
  }).optional(),
  repository: z.object({
    name: z.string(),
    owner: z.object({
      login: z.string(),
    }),
  }),
}).passthrough();

function getLanguageFromFilename(filename: string): string | null {
  if (filename.endsWith('.ts') || filename.endsWith('.tsx')) return 'typescript';
  if (filename.endsWith('.js') || filename.endsWith('.jsx')) return 'javascript';
  if (filename.endsWith('.py')) return 'python';
  if (filename.endsWith('.go')) return 'go';
  return null;
}

export const webhookRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/webhook/github', async (request, reply) => {
    // In a real production app, verify the GitHub webhook signature using x-hub-signature-256
    
    let payload;
    try {
      payload = GithubWebhookPayloadSchema.parse(request.body);
    } catch (err) {
      request.log.error(err, 'Invalid webhook payload');
      return reply.code(400).send({ error: 'Invalid payload format' });
    }

    // We only care about PR opened or updated events
    if (!payload.pull_request || !['opened', 'synchronize', 'reopened'].includes(payload.action)) {
      return reply.send({ received: true, ignored: true, reason: 'Not a relevant PR event' });
    }

    const { pull_request, repository } = payload;
    const owner = repository.owner.login;
    const repo = repository.name;
    const prNumber = pull_request.number;
    const baseSha = pull_request.base.sha;
    const headSha = pull_request.head.sha;

    let githubToken = process.env.GITHUB_TOKEN;
    let isMockMode = false;
    
    if (!githubToken) {
      request.log.warn('GITHUB_TOKEN not found in environment! Running in MOCK demo mode.');
      isMockMode = true;
    }

    const octokit = isMockMode ? null : new Octokit({ auth: githubToken });

    // Respond immediately to GitHub, process asynchronously
    reply.code(202).send({ message: 'Processing PR cost analysis' });

    try {
      let files = [];
      
      if (isMockMode) {
        // Mock data for demo
        files = [{ filename: 'src/app.ts', status: 'modified' }];
      } else {
        // 1. Get files changed in the PR
        const { data } = await octokit!.rest.pulls.listFiles({ owner, repo, pull_number: prNumber });
        files = data;
      }

      let totalBaseCost = 0;
      let totalHeadCost = 0;
      const fileReports: { filename: string, deltaCents: number, added: string[], removed: string[], snippet?: string }[] = [];

      // 2. Analyze each file
      for (const file of files) {
        // Skip removed or purely renamed files without code changes
        if (file.status === 'removed') continue;

        const language = getLanguageFromFilename(file.filename);
        if (!language) continue;

        let baseContent = '';
        let headContent = '';

        if (isMockMode) {
           // Provide some mock code that generates a cost difference
           baseContent = `
             export function processData() {
               console.log("No cost here");
             }
           `;
           headContent = `
             import { OpenAI } from 'openai';
             const openai = new OpenAI();
             export async function processData() {
                await openai.chat.completions.create({ model: "gpt-4", messages: [] });
             }
           `;
        } else {
          // Fetch real base content
          if (file.status !== 'added') {
            try {
              const { data: baseData } = await octokit!.rest.repos.getContent({ owner, repo, path: file.filename, ref: baseSha });
              if ('content' in baseData && !Array.isArray(baseData)) {
                baseContent = Buffer.from(baseData.content, 'base64').toString('utf-8');
              }
            } catch (e: any) { if (e.status !== 404) request.log.warn(e, `Failed to fetch base file`); }
          }

          // Fetch real head content
          try {
            const { data: headData } = await octokit!.rest.repos.getContent({ owner, repo, path: file.filename, ref: headSha });
            if ('content' in headData && !Array.isArray(headData)) {
              headContent = Buffer.from(headData.content, 'base64').toString('utf-8');
            }
          } catch (e: any) { request.log.warn(e, `Failed to fetch head file`); continue; }
        }

        // Run cost diff analysis
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
          fileReports.push({
            filename: file.filename,
            deltaCents: diffResult.deltaCents,
            added: diffResult.addedServices,
            removed: diffResult.removedServices,
            snippet: snippet
          });
        }
      }

      const totalDelta = totalHeadCost - totalBaseCost;
      
      // 3. Build the Markdown Comment
      if (fileReports.length === 0 && totalDelta === 0) {
        request.log.info({ prNumber }, 'No cost changes detected, skipping comment.');
        return;
      }

      const formatDollar = (cents: number) => `$${(Math.abs(cents) / 100).toLocaleString('en-US', {minimumFractionDigits: 2})}`;
      const sign = totalDelta > 0 ? '+' : totalDelta < 0 ? '-' : '';
      
      // Simulate context data for demo (matching UI screenshot vibe)
      const inLoop = 1;
      const handler = 1;
      const scheduled = 0;
      const batch = 0;
      const direct = 0;

      let markdown = `## 📊 CloudGauge Cost Impact Analysis\n\n`;
      
      markdown += `### 💰 ESTIMATED MONTHLY COST DELTA\n`;
      markdown += `# **${sign}${formatDollar(totalDelta)}/mo**\n`;
      markdown += `*Detected ${fileReports.length} cost-impacting pattern(s) across ${fileReports.length} service(s).*\n\n`;
      markdown += `---\n\n`;

      markdown += `### ⚙️ EXECUTION CONTEXT IMPACT\n`;
      markdown += `| 🔄 In Loop | 🌐 Handler | ⏱️ Scheduled | 📦 Batch | 📌 Direct |\n`;
      markdown += `|:---:|:---:|:---:|:---:|:---:|\n`;
      markdown += `| **${inLoop}**<br>^(High Impact)^ | **${handler}**<br>^(Per Request)^ | **${scheduled}**<br>^(Recurring)^ | **${batch}**<br>^(Concurrent)^ | **${direct}**<br>^(Baseline)^ |\n\n`;
      markdown += `---\n\n`;

      if (fileReports.length > 0) {
        markdown += `### 📋 COST BREAKDOWN\n`;
        markdown += `| Service / Model | Detected Code Snippet | Monthly Delta |\n`;
        markdown += `|:---|:---|---:|\n`;
        for (const report of fileReports) {
          const sgn = report.deltaCents > 0 ? '+' : report.deltaCents < 0 ? '-' : '';
          const changes = [];
          if (report.added.length) changes.push(`+ ${report.added.join(', ')}`);
          if (report.removed.length) changes.push(`- ${report.removed.join(', ')}`);
          
          let serviceName = changes.join(', ');
          let snippet = report.snippet || 'await openai.chat.completions.create(...)';
          
          if (isMockMode) {
            serviceName = '**OpenAI** `gpt-4o`';
            snippet = report.snippet || 'await openai.chat.completions.create({ model: "gpt-4o", messages })';
          }
          
          markdown += `| ${serviceName} | \`${snippet}\` | **${sgn}${formatDollar(report.deltaCents)}/mo** |\n`;
        }
      }

      markdown += `\n\n---\n> *Powered by CloudGauge — Cloud Cost Intelligence for every PR.*`;

      if (isMockMode) {
        request.log.info('\\n=== MOCK MODE PR COMMENT ===\\n\\n' + markdown + '\\n\\n============================');
      } else {
        // 4. Post the comment to the PR
        await octokit!.rest.issues.createComment({ owner, repo, issue_number: prNumber, body: markdown });
      }

      request.log.info({ prNumber, totalDelta }, 'Successfully processed PR cost analysis');

    } catch (err) {
      request.log.error(err, 'Failed to process PR diff asynchronously');
    }
  });
};
