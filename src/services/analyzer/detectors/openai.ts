import type { DetectionMatch, DetectorFn } from '../types.js';

const MODEL_ALIASES: Record<string, string> = {
  'gpt-4o':                 'gpt-4o',
  'gpt-4o-mini':            'gpt-4o-mini',
  'gpt-4-turbo':            'gpt-4-turbo',
  'gpt-4':                  'gpt-4',
  'gpt-3.5-turbo':          'gpt-3.5-turbo',
  'text-embedding-3-small': 'text-embedding-3-small',
  'text-embedding-3-large': 'text-embedding-3-large',
};

/**
 * Detects OpenAI API calls in ASTs.
 * Matches: openai.chat.completions.create / client.chat.completions / openai.completions
 */
export const openaiDetector: DetectorFn = (ast, code) => {
  const matches: DetectionMatch[] = [];

  function walk(node: any): void {
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
        const model   = extractStringArg(node.arguments, 'model');
        const maxTok  = extractNumberArg(node.arguments, 'max_tokens') ?? 1000;
        const isEmbed = /embeddings/i.test(callStr);

        matches.push({
          service:       'openai',
          model:         model ? (MODEL_ALIASES[model] ?? model) : 'gpt-4o',
          operation:     isEmbed ? 'embeddings.create' : 'chat.completions.create',
          inputTokens:   500,
          outputTokens:  isEmbed ? 0 : maxTok,
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
