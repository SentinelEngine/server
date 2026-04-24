import type { DetectionMatch, DetectorFn } from '../types.js';

const MODEL_ALIASES: Record<string, string> = {
  'gpt-4o':                  'gpt-4o',
  'gpt-4o-mini':             'gpt-4o-mini',
  'gpt-4-turbo':             'gpt-4-turbo',
  'gpt-4-vision-preview':    'gpt-4o',        // vision maps to gpt-4o pricing
  'gpt-4':                   'gpt-4',
  'gpt-3.5-turbo':           'gpt-3.5-turbo',
  'text-embedding-3-small':  'text-embedding-3-small',
  'text-embedding-3-large':  'text-embedding-3-large',
};

/** Resolve a raw model string (possibly versioned, e.g. "gpt-4-vision-preview") to a canonical alias key. */
function resolveOpenAIModel(raw: string | null): string {
  if (!raw) return 'gpt-4o';
  const lower = raw.toLowerCase();
  // Exact match first
  if (MODEL_ALIASES[lower]) return MODEL_ALIASES[lower];
  // Partial prefix match
  for (const key of Object.keys(MODEL_ALIASES)) {
    if (lower.startsWith(key) || lower.includes(key)) return MODEL_ALIASES[key];
  }
  return 'gpt-4o';
}

/** Returns true if this AST node is nested inside a for/while/forEach loop. */
function isInsideLoop(node: any, ancestors: any[]): boolean {
  return ancestors.some(a =>
    a.type === 'ForStatement' ||
    a.type === 'ForInStatement' ||
    a.type === 'ForOfStatement' ||
    a.type === 'WhileStatement' ||
    a.type === 'DoWhileStatement' ||
    (a.type === 'CallExpression' && /forEach|map|reduce|filter/.test(a.callee?.property?.name ?? '')),
  );
}

/**
 * Detects OpenAI API calls in ASTs.
 * Matches: openai.chat.completions.create / client.chat.completions / openai.completions
 */
export const openaiDetector: DetectorFn = (ast, code) => {
  const matches: DetectionMatch[] = [];

  function walk(node: any, ancestors: any[] = []): void {
    if (
      node.type === 'CallExpression' &&
      node.callee?.type === 'MemberExpression' &&
      node.range
    ) {
      const callStr = code.slice(node.range[0], node.range[1]);
      const isOpenAI =
        /openai\.(chat\.completions|completions|createChat|embeddings)/i.test(callStr) ||
        /client\.chat\.completions/i.test(callStr) ||
        /openai\.createChatCompletion/i.test(callStr);

      if (isOpenAI) {
        const rawModel = extractStringArg(node.arguments, 'model');
        const maxTok   = extractNumberArg(node.arguments, 'max_tokens') ?? 1_000;
        const isEmbed  = /embeddings/i.test(callStr);
        // If the call is inside a loop, assume it runs once per item in a typical batch (1 000 items/month)
        const inLoop   = isInsideLoop(node, ancestors);

        matches.push({
          service:       'openai',
          model:         resolveOpenAIModel(rawModel),
          operation:     isEmbed ? 'embeddings.create' : 'chat.completions.create',
          inputTokens:   500,
          outputTokens:  isEmbed ? 0 : maxTok,
          callsPerMonth: inLoop ? 50_000 : 10_000,
          line:          node.loc.start.line,
          column:        node.loc.start.column,
          snippet:       callStr.slice(0, 80),
        });
      }
    }

    const nextAncestors = [...ancestors, node];
    for (const key of Object.keys(node)) {
      const child = (node as any)[key];
      if (child && typeof child === 'object') {
        if (Array.isArray(child)) child.forEach((c: any) => c?.type && walk(c, nextAncestors));
        else if (child.type) walk(child, nextAncestors);
      }
    }
  }

  walk(ast);
  return matches;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractStringArg(args: any[], key: string): string | null {
  for (const arg of args) {
    if (arg.type !== 'ObjectExpression') continue;
    const prop = arg.properties?.find(
      (p: any) =>
        p.type === 'Property' &&
        (p.key?.name === key || p.key?.value === key),
    );
    if (prop?.value?.type === 'Literal') return String(prop.value.value);
  }
  return null;
}

function extractNumberArg(args: any[], key: string): number | null {
  for (const arg of args) {
    if (arg.type !== 'ObjectExpression') continue;
    const prop = arg.properties?.find(
      (p: any) =>
        p.type === 'Property' &&
        (p.key?.name === key || p.key?.value === key),
    );
    if (prop?.value?.type === 'Literal' && typeof prop.value.value === 'number')
      return prop.value.value;
  }
  return null;
}
