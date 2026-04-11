import { parse } from '@typescript-eslint/typescript-estree';
import type { SupportedLanguage, AnalysisResult } from './types.js';
import { openaiDetector }     from './detectors/openai.js';
import { anthropicDetector }  from './detectors/anthropic.js';
import { lambdaDetector }     from './detectors/lambda.js';
import { dynamodbDetector }   from './detectors/dynamodb.js';
import { s3Detector }         from './detectors/s3.js';
import { redisDetector }      from './detectors/redis.js';
import { apiGatewayDetector } from './detectors/api-gateway.js';

const DETECTORS = [
  openaiDetector,
  anthropicDetector,
  lambdaDetector,
  dynamodbDetector,
  s3Detector,
  redisDetector,
  apiGatewayDetector,
];

/**
 * Parse source code into an AST and run all registered detectors.
 * Currently supports TypeScript and JavaScript; returns an error for other languages.
 */
export function analyzeCode(code: string, language: SupportedLanguage): AnalysisResult {
  if (language !== 'typescript' && language !== 'javascript') {
    return {
      language,
      detections: [],
      errors: [`Language "${language}" is not yet supported for static analysis.`],
    };
  }

  const errors: string[] = [];
  let ast: any;

  try {
    ast = parse(code, {
      jsx:     true,
      tokens:  false,
      comment: false,
      loc:     true,
      range:   true,
    });
  } catch (err: any) {
    return {
      language,
      detections: [],
      errors: ['AST parse error: ' + err.message],
    };
  }

  const detections = DETECTORS.flatMap(detector => {
    try {
      return detector(ast, code);
    } catch (e: any) {
      errors.push(`Detector error: ${e.message}`);
      return [];
    }
  });

  return { language, detections, errors };
}
