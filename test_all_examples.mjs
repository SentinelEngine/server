/**
 * Run all 5 test files through the actual AST pipeline.
 * Usage: node test_all_examples.mjs
 */
import { readFileSync } from 'fs';
import { parse } from '@typescript-eslint/typescript-estree';

const OPENAI_PRICING = {
  'gpt-4o':          { input: 0.005,   output: 0.015  },
  'gpt-4o-mini':     { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo':     { input: 0.01,    output: 0.03   },
  'gpt-4':           { input: 0.03,    output: 0.06   },
  'gpt-3.5-turbo':   { input: 0.0005,  output: 0.0015 },
};
const ANTHROPIC_PRICING = {
  'claude-3-5-sonnet': { input: 0.003,   output: 0.015   },
  'claude-3-opus':     { input: 0.015,   output: 0.075   },
  'claude-3-sonnet':   { input: 0.003,   output: 0.015   },
  'claude-3-haiku':    { input: 0.00025, output: 0.00125 },
  'claude-2':          { input: 0.008,   output: 0.024   },
};
const OA_ALIASES = {
  'gpt-4-vision-preview': 'gpt-4o', 'gpt-4o': 'gpt-4o', 'gpt-4o-mini': 'gpt-4o-mini',
  'gpt-4-turbo': 'gpt-4-turbo', 'gpt-4': 'gpt-4', 'gpt-3.5-turbo': 'gpt-3.5-turbo',
};
const AN_ALIASES = {
  'claude-3-opus-20240229': 'claude-3-opus', 'claude-3-sonnet-20240229': 'claude-3-sonnet',
  'claude-3-haiku-20240307': 'claude-3-haiku', 'claude-3-5-sonnet-20240620': 'claude-3-5-sonnet',
  'claude-3-opus': 'claude-3-opus', 'claude-3-sonnet': 'claude-3-sonnet',
  'claude-3-haiku': 'claude-3-haiku', 'claude-3-5-sonnet': 'claude-3-5-sonnet',
};

function resolveOA(raw) {
  if (!raw) return 'gpt-4o';
  const l = raw.toLowerCase();
  if (OA_ALIASES[l]) return OA_ALIASES[l];
  for (const k of Object.keys(OA_ALIASES)) if (l.includes(k)) return OA_ALIASES[k];
  return 'gpt-4o';
}
function resolveAN(raw) {
  if (!raw) return 'claude-3-5-sonnet';
  const l = raw.toLowerCase();
  if (AN_ALIASES[l]) return AN_ALIASES[l];
  const match = Object.keys(AN_ALIASES).filter(k => l.includes(k)).sort((a,b) => b.length - a.length)[0];
  return match ? AN_ALIASES[match] : 'claude-3-5-sonnet';
}
function inLoop(ancestors) {
  return ancestors.some(a => ['ForStatement','ForInStatement','ForOfStatement','WhileStatement','DoWhileStatement'].includes(a.type));
}
function extractStr(args, key) {
  for (const arg of args) {
    if (arg.type !== 'ObjectExpression') continue;
    const p = arg.properties?.find(p => p.key?.name === key || p.key?.value === key);
    if (p?.value?.type === 'Literal') return String(p.value.value);
  }
  return null;
}

function detectAll(code) {
  const ast = parse(code, { jsx: true, loc: true, range: true });
  const hits = [];
  function walk(node, anc = []) {
    if (node.type === 'CallExpression' && node.range) {
      const s = code.slice(node.range[0], node.range[1]);
      const loop = inLoop(anc);
      const calls = loop ? 50_000 : 10_000;
      if (node.callee?.type === 'MemberExpression') {
        if (/openai\.(chat\.completions|completions|embeddings)/i.test(s)) {
          hits.push({ service: 'openai', model: resolveOA(extractStr(node.arguments,'model')), calls, inLoop: loop, snippet: s.slice(0,70) });
        }
        if (/anthropic\.messages\.(create|stream)/i.test(s)) {
          hits.push({ service: 'anthropic', model: resolveAN(extractStr(node.arguments,'model')), calls, inLoop: loop, snippet: s.slice(0,70) });
        }
        if (/s3(Client)?\.send|new\s+PutObjectCommand/i.test(s)) {
          hits.push({ service: 's3', model: null, calls: loop ? 200_000 : 100_000, inLoop: loop, snippet: s.slice(0,70) });
        }
        if (/lambda.*send|new\s+InvokeCommand/i.test(s)) {
          hits.push({ service: 'lambda', model: null, calls, inLoop: loop, snippet: s.slice(0,70) });
        }
        if (/dynamo.*send|new\s+PutItemCommand|new\s+GetItemCommand/i.test(s)) {
          hits.push({ service: 'dynamodb', model: null, calls, inLoop: loop, snippet: s.slice(0,70) });
        }
      }
      if (/new\s+PutObjectCommand/i.test(s)) {
        if (!hits.find(h => h.snippet.startsWith(s.slice(0,30)))) {
          hits.push({ service: 's3', model: null, calls: loop ? 200_000 : 100_000, inLoop: loop, snippet: s.slice(0,70) });
        }
      }
    }
    const next = [...anc, node];
    for (const k of Object.keys(node)) {
      const c = node[k];
      if (c && typeof c === 'object') {
        if (Array.isArray(c)) c.forEach(x => x?.type && walk(x, next));
        else if (c.type) walk(c, next);
      }
    }
  }
  walk(ast);
  return hits;
}

function cost(h) {
  if (h.service === 'openai') {
    const p = OPENAI_PRICING[h.model] ?? OPENAI_PRICING['gpt-4o'];
    return Math.round((500/1000)*p.input*h.calls*100 + (1000/1000)*p.output*h.calls*100);
  }
  if (h.service === 'anthropic') {
    const p = ANTHROPIC_PRICING[h.model] ?? ANTHROPIC_PRICING['claude-3-5-sonnet'];
    return Math.round((500/1000)*p.input*h.calls*100 + (1000/1000)*p.output*h.calls*100);
  }
  if (h.service === 's3')       return Math.round(10*0.023*100 + (h.calls/1000)*0.005*100);
  if (h.service === 'lambda')   return 0;
  if (h.service === 'dynamodb') return Math.round(h.calls * 0.00000125 * 100);
  return 0;
}

const FILES = [
  'examples/test1_cheap_models.js',
  'examples/test2_expensive_models.js',
  'examples/test3_loop_antipattern.js',
  'examples/test4_versioned_models.js',
  'examples/test5_multi_service.js',
];

for (const f of FILES) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📄 ${f}`);
  console.log('═'.repeat(60));
  const code = readFileSync(f, 'utf-8');
  const hits = detectAll(code);
  let total = 0;
  if (hits.length === 0) {
    console.log('  ❌ No detections!');
  }
  for (const h of hits) {
    const c = cost(h);
    total += c;
    const loop = h.inLoop ? '🔄 IN LOOP' : '        ';
    console.log(`  ✅ ${loop} [${h.service}] ${h.model || ''}`);
    console.log(`        calls/mo: ${h.calls.toLocaleString()}  →  $${(c/100).toFixed(2)}/mo`);
    console.log(`        snippet: ${h.snippet}`);
  }
  const criticality = hits.some(h => h.inLoop) ? '🔴 MAJOR' : total > 5000 ? '🟡 MINOR' : '🟢 LOW';
  console.log(`\n  💰 TOTAL: $${(total/100).toFixed(2)}/mo   ${criticality}`);
}
