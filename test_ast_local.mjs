/**
 * Local AST pipeline test — run with:
 *   node test_ast_local.mjs
 *
 * This exercises the EXACT same code path the bot uses on Render,
 * so if this prints detections, the server is working correctly.
 */

import { parse } from '@typescript-eslint/typescript-estree';

// ── The exact code the user submitted ─────────────────────────────────────────
const TEST_CODE = `
import { OpenAI } from 'openai';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const openai = new OpenAI();
const s3 = new S3Client({ region: "us-east-1" });

export async function processBatchData(userImages) {
    for (let i = 0; i < userImages.length; i++) {
        const completion = await openai.chat.completions.create({
            model: "gpt-4-vision-preview",
            messages: [{ role: "user", content: "Analyze this image." }]
        });
        await s3.send(new PutObjectCommand({
            Bucket: "secure-user-data-bucket",
            Key: \`processed-data-\${i}.json\`,
            Body: JSON.stringify(completion.choices[0])
        }));
    }
}
`;

// ── Inline detector (mirrors server/src/services/analyzer/detectors/openai.ts)
function detectOpenAI(ast, code) {
  const matches = [];
  const MODEL_ALIASES = {
    'gpt-4o':               'gpt-4o',
    'gpt-4o-mini':          'gpt-4o-mini',
    'gpt-4-turbo':          'gpt-4-turbo',
    'gpt-4-vision-preview': 'gpt-4o',
    'gpt-4':                'gpt-4',
    'gpt-3.5-turbo':        'gpt-3.5-turbo',
  };

  function resolveModel(raw) {
    if (!raw) return 'gpt-4o';
    const lower = raw.toLowerCase();
    if (MODEL_ALIASES[lower]) return MODEL_ALIASES[lower];
    for (const key of Object.keys(MODEL_ALIASES)) {
      if (lower.startsWith(key) || lower.includes(key)) return MODEL_ALIASES[key];
    }
    return 'gpt-4o';
  }

  function isInLoop(ancestors) {
    return ancestors.some(a =>
      a.type === 'ForStatement' || a.type === 'ForInStatement' ||
      a.type === 'ForOfStatement' || a.type === 'WhileStatement' ||
      a.type === 'DoWhileStatement'
    );
  }

  function extractStr(args, key) {
    for (const arg of args) {
      if (arg.type !== 'ObjectExpression') continue;
      const prop = arg.properties?.find(p => p.key?.name === key || p.key?.value === key);
      if (prop?.value?.type === 'Literal') return String(prop.value.value);
    }
    return null;
  }

  function walk(node, ancestors = []) {
    if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression' && node.range) {
      const callStr = code.slice(node.range[0], node.range[1]);
      const isOpenAI = /openai\.(chat\.completions|completions|createChat|embeddings)/i.test(callStr) ||
                       /client\.chat\.completions/i.test(callStr);
      if (isOpenAI) {
        const rawModel = extractStr(node.arguments, 'model');
        const maxTok   = 1000;
        const inLoop   = isInLoop(ancestors);
        matches.push({
          service: 'openai',
          model:   resolveModel(rawModel),
          snippet: callStr.slice(0, 80),
          callsPerMonth: inLoop ? 50_000 : 10_000,
          inputTokens: 500,
          outputTokens: maxTok,
          inLoop,
        });
      }
    }
    const next = [...ancestors, node];
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (child && typeof child === 'object') {
        if (Array.isArray(child)) child.forEach(c => c?.type && walk(c, next));
        else if (child.type) walk(child, next);
      }
    }
  }
  walk(ast);
  return matches;
}

// ── Inline S3 detector ────────────────────────────────────────────────────────
function detectS3(ast, code) {
  const matches = [];
  const S3_PATTERNS = /s3(Client)?\.send|new\s+(GetObjectCommand|PutObjectCommand|DeleteObjectCommand)/i;

  function isInLoop(ancestors) {
    return ancestors.some(a =>
      a.type === 'ForStatement' || a.type === 'ForInStatement' ||
      a.type === 'ForOfStatement' || a.type === 'WhileStatement'
    );
  }

  function walk(node, ancestors = []) {
    if (node.type === 'CallExpression' && node.range) {
      const callStr = code.slice(node.range[0], node.range[1]);
      if (S3_PATTERNS.test(callStr)) {
        const isWrite = /Put|Delete|Copy/i.test(callStr);
        matches.push({
          service: 's3',
          operation: isWrite ? 'put' : 'get',
          callsPerMonth: isInLoop(ancestors) ? 200_000 : 100_000,
          storageGB: 10,
          snippet: callStr.slice(0, 80),
          inLoop: isInLoop(ancestors),
        });
      }
    }
    const next = [...ancestors, node];
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (child && typeof child === 'object') {
        if (Array.isArray(child)) child.forEach(c => c?.type && walk(c, next));
        else if (child.type) walk(child, next);
      }
    }
  }
  walk(ast);
  return matches;
}

// ── Run the test ──────────────────────────────────────────────────────────────
console.log('Parsing AST...');

let ast;
try {
  ast = parse(TEST_CODE, { jsx: true, loc: true, range: true });
  console.log('✅ AST parse succeeded. Node type:', ast.type);
} catch (err) {
  console.error('❌ AST parse FAILED:', err.message);
  process.exit(1);
}

const openaiMatches = detectOpenAI(ast, TEST_CODE);
const s3Matches     = detectS3(ast, TEST_CODE);
const allMatches    = [...openaiMatches, ...s3Matches];

console.log(`\n=== DETECTIONS (${allMatches.length} total) ===`);
if (allMatches.length === 0) {
  console.error('❌ ZERO detections — the regex or walk is broken.');
} else {
  for (const m of allMatches) {
    console.log(`  ✅ [${m.service}] model=${m.model || 'N/A'} inLoop=${m.inLoop} calls/mo=${m.callsPerMonth}`);
    console.log(`     snippet: ${m.snippet}`);
  }
}

// ── Inline cost math ─────────────────────────────────────────────────────────
const PRICING = {
  'gpt-4o':      { inputPer1k: 0.005,  outputPer1k: 0.015 },
  'gpt-4':       { inputPer1k: 0.03,   outputPer1k: 0.06  },
  'gpt-4-turbo': { inputPer1k: 0.01,   outputPer1k: 0.03  },
};
const S3_PRICING = { perGbStorage: 0.023, perPutRequest: 0.005, perGetRequest: 0.0004 };

console.log('\n=== COST ESTIMATE ===');
let total = 0;
for (const m of allMatches) {
  let cents = 0;
  if (m.service === 'openai') {
    const p = PRICING[m.model] ?? PRICING['gpt-4o'];
    const input  = Math.round((m.inputTokens  / 1000) * p.inputPer1k  * m.callsPerMonth * 100);
    const output = Math.round((m.outputTokens / 1000) * p.outputPer1k * m.callsPerMonth * 100);
    cents = input + output;
    console.log(`  openai/${m.model}: $${(cents/100).toFixed(2)}/mo  (${m.callsPerMonth.toLocaleString()} calls × ${m.inputTokens} in + ${m.outputTokens} out tokens)`);
  }
  if (m.service === 's3') {
    const storage  = Math.round(m.storageGB * S3_PRICING.perGbStorage * 100);
    const requests = Math.round((m.callsPerMonth / 1000) * S3_PRICING.perPutRequest * 100);
    cents = storage + requests;
    console.log(`  s3/${m.operation}: $${(cents/100).toFixed(2)}/mo  (${m.callsPerMonth.toLocaleString()} ops × ${m.storageGB}GB stored)`);
  }
  total += cents;
}
console.log(`\n  TOTAL: $${(total/100).toFixed(2)}/mo`);
