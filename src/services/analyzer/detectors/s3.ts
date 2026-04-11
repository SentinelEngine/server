import type { DetectorFn, DetectionMatch } from '../types.js';

/**
 * Detects AWS S3 operations.
 * Matches: s3Client.send / new GetObjectCommand / PutObjectCommand / etc.
 */
const S3_PATTERNS =
  /s3(Client)?\.send|new\s+(GetObjectCommand|PutObjectCommand|DeleteObjectCommand|ListObjectsV2Command|CopyObjectCommand|CreateMultipartUploadCommand)/i;

export const s3Detector: DetectorFn = (ast, code) => {
  const matches: DetectionMatch[] = [];

  function walk(node: any): void {
    if (node.type === 'CallExpression' && node.range) {
      const callStr = code.slice(node.range[0], node.range[1]);
      if (S3_PATTERNS.test(callStr)) {
        const isWrite = /Put|Delete|Copy|Multipart/i.test(callStr);
        matches.push({
          service:       's3',
          operation:     isWrite ? 'put' : 'get',
          callsPerMonth: 100_000,
          storageGB:     10,
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
