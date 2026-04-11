import type { DetectionMatch, DetectorFn } from '../types.js';

const MODEL_ALIASES: Record<string, string> = {
  'claude-3-5-sonnet': 'claude-3-5-sonnet',
  'claude-3-opus':     'claude-3-opus',
  'claude-3-sonnet':   'claude-3-sonnet',
  'claude-3-haiku':    'claude-3-haiku',
  'claude-2':          'claude-2',
  'claude-instant':    'claude-instant',
};

/**
 * Detects Anthropic SDK calls in ASTs.
 * Matches: anthropic.messages.create / client.messages.create / anthropic.complete
 */
export const anthropicDetector: DetectorFn = (ast, code) => {
  const matches: DetectionMatch[] = [];

  function walk(node: any): void {
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
        const model  = extractStringArg(node.arguments, 'model');
        const maxTok = extractNumberArg(node.arguments, 'max_tokens') ?? 1024;
        const rawModel = model?.toLowerCase() ?? '';
        const resolvedModel =
          Object.keys(MODEL_ALIASES).find(k => rawModel.includes(k)) ??
          'claude-3-5-sonnet';

        matches.push({
          service:       'anthropic',
          model:         resolvedModel,
          operation:     'messages.create',
          inputTokens:   500,
          outputTokens:  maxTok,
          callsPerMonth: 10_000,
          line:          node.loc.start.line,
          column:        node.loc.start.column,
          snippet:       callStr.slice(0, 80),
        });
      }
    }

    for (const key of Object.keys(node)) {
      const child = (node as any)[key];
      if (child && typeof child === 'object') {
        if (Array.isArray(child)) child.forEach((c: any) => c?.type && walk(c));
        else if (child.type) walk(child);
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
