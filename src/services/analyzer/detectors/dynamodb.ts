import type { DetectorFn, DetectionMatch } from '../types.js';

/**
 * Detects AWS DynamoDB operations.
 * Matches: ddb.send / dynamoDBClient / GetItemCommand / PutItemCommand / QueryCommand etc.
 */
const DYNAMO_PATTERNS =
  /dynamoDB(Client)?\.send|new\s+(GetItemCommand|PutItemCommand|QueryCommand|ScanCommand|UpdateItemCommand|DeleteItemCommand|BatchWriteItemCommand|TransactWriteItemsCommand)/i;

export const dynamodbDetector: DetectorFn = (ast, code) => {
  const matches: DetectionMatch[] = [];

  function walk(node: any): void {
    if (node.type === 'CallExpression' && node.range) {
      const callStr = code.slice(node.range[0], node.range[1]);
      if (DYNAMO_PATTERNS.test(callStr)) {
        const isWrite = /Put|Update|Delete|BatchWrite|TransactWrite/i.test(callStr);
        matches.push({
          service:       'dynamodb',
          operation:     isWrite ? 'write' : 'read',
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
