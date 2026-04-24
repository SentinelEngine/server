import type { DetectionMatch, DetectorFn } from '../types.js';

const MODEL_ALIASES: Record<string, string> = {
  // Short names
  'claude-3-5-sonnet':      'claude-3-5-sonnet',
  'claude-3-opus':          'claude-3-opus',
  'claude-3-sonnet':        'claude-3-sonnet',
  'claude-3-haiku':         'claude-3-haiku',
  'claude-2':               'claude-2',
  'claude-instant':         'claude-instant',
  // Full versioned names
  'claude-3-opus-20240229':    'claude-3-opus',
  'claude-3-sonnet-20240229':  'claude-3-sonnet',
  'claude-3-haiku-20240307':   'claude-3-haiku',
  'claude-3-5-sonnet-20240620':'claude-3-5-sonnet',
};

/** Resolve raw model string (full versioned or short) to a canonical alias. */
function resolveAnthropicModel(raw: string | null): string {
  if (!raw) return 'claude-3-5-sonnet';
  const lower = raw.toLowerCase();
  if (MODEL_ALIASES[lower]) return MODEL_ALIASES[lower];
  // Partial match — prefer longest key that is a substring of raw
  const match = Object.keys(MODEL_ALIASES)
    .filter(k => lower.includes(k))
    .sort((a, b) => b.length - a.length)[0];
  return match ? MODEL_ALIASES[match] : 'claude-3-5-sonnet';
}

/** Returns true if this AST node is nested inside a for/while/forEach loop. */
function isInsideLoop(_node: any, ancestors: any[]): boolean {
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
 * Detects Anthropic SDK calls in ASTs.
 * Matches: anthropic.messages.create / client.messages.create / anthropic.complete
 */
export const anthropicDetector: DetectorFn = (ast, code) => {
  const matches: DetectionMatch[] = [];

  function walk(node: any, ancestors: any[] = []): void {
    if (
      node.type === 'CallExpression' &&
      node.callee?.type === 'MemberExpression' &&
      node.range
    ) {
      const callStr = code.slice(node.range[0], node.range[1]);
      const isAnthropic =
        /anthropic\.messages\.(create|stream)/i.test(callStr) ||
        /client\.messages\.create/i.test(callStr) ||
        /anthropic\.(complete|createMessage)/i.test(callStr);

      if (isAnthropic) {
        const model   = extractStringArg(node.arguments, 'model');
        const maxTok  = extractNumberArg(node.arguments, 'max_tokens') ?? 1_024;
        const inLoop  = isInsideLoop(node, ancestors);

        matches.push({
          service:       'anthropic',
          model:         resolveAnthropicModel(model),
          operation:     'messages.create',
          inputTokens:   500,
          outputTokens:  maxTok,
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
