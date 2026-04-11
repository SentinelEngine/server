import type { DetectorFn, DetectionMatch } from '../types.js';

/**
 * Detects AWS API Gateway invocations.
 * Matches: @aws-sdk/client-api-gateway usage or axios/got/fetch calls to API GW URLs.
 */
const APIGW_SDK_PATTERN =
  /apiGateway(Client)?\.send|new\s+(GetRestApiCommand|CreateDeploymentCommand|CreateUsagePlanCommand|GetApiKeysCommand)/i;

const APIGW_URL_PATTERN =
  /https?:\/\/[a-z0-9]+\.execute-api\.[a-z0-9-]+\.amazonaws\.com/i;

export const apiGatewayDetector: DetectorFn = (ast, code) => {
  const matches: DetectionMatch[] = [];

  function walk(node: any): void {
    // Match SDK calls
    if (node.type === 'CallExpression' && node.range) {
      const callStr = code.slice(node.range[0], node.range[1]);
      if (APIGW_SDK_PATTERN.test(callStr)) {
        matches.push({
          service:       'api-gateway',
          operation:     'rest-api-call',
          callsPerMonth: 1_000_000,
          line:          node.loc.start.line,
          column:        node.loc.start.column,
          snippet:       callStr.slice(0, 80),
        });
        return;
      }
    }

    // Match literal API Gateway URLs in string literals
    if (
      (node.type === 'Literal' || node.type === 'TemplateLiteral') &&
      node.range
    ) {
      const raw = node.type === 'Literal'
        ? String(node.value ?? '')
        : code.slice(node.range[0], node.range[1]);

      if (APIGW_URL_PATTERN.test(raw)) {
        matches.push({
          service:       'api-gateway',
          operation:     'rest-api-call',
          callsPerMonth: 1_000_000,
          line:          node.loc?.start?.line ?? 0,
          column:        node.loc?.start?.column ?? 0,
          snippet:       raw.slice(0, 80),
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
