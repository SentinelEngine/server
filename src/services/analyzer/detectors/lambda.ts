import type { DetectorFn, DetectionMatch } from '../types.js';

/**
 * Detects AWS Lambda invocations.
 * Matches: lambdaClient.invoke / new InvokeCommand / lambda.send(new InvokeCommand...)
 */
export const lambdaDetector: DetectorFn = (ast, code) => {
  const matches: DetectionMatch[] = [];

  function walk(node: any): void {
    if (node.type === 'CallExpression' && node.range) {
      const callStr = code.slice(node.range[0], node.range[1]);
      const isLambda =
        /lambda(Client)?\.invoke/i.test(callStr) ||
        /new\s+InvokeCommand/i.test(callStr) ||
        /lambda\.send\s*\(/i.test(callStr);

      if (isLambda) {
        matches.push({
          service:       'aws-lambda',
          operation:     'invoke',
          memoryMB:      128,
          durationMs:    200,
          callsPerMonth: 100_000,
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
