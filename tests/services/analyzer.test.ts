import { describe, it, expect } from 'vitest';
import { analyzeCode } from '../../src/services/analyzer/index.js';
import {
  OPENAI_SAMPLE,
  OPENAI_MINI_SAMPLE,
  ANTHROPIC_SAMPLE,
  LAMBDA_SAMPLE,
  DYNAMODB_SAMPLE,
  S3_SAMPLE,
  REDIS_SAMPLE,
  PLAIN_SAMPLE,
  MULTI_SERVICE_SAMPLE,
} from '../fixtures/samples.js';

describe('analyzeCode — OpenAI', () => {
  it('detects gpt-4o call with correct model and output tokens', () => {
    const { detections, errors } = analyzeCode(OPENAI_SAMPLE, 'typescript');
    expect(errors).toHaveLength(0);
    expect(detections.length).toBeGreaterThanOrEqual(1);
    const match = detections.find(d => d.service === 'openai');
    expect(match).toBeDefined();
    expect(match!.model).toBe('gpt-4o');
    expect(match!.outputTokens).toBe(2000);
  });

  it('detects gpt-4o-mini with correct token count', () => {
    const { detections } = analyzeCode(OPENAI_MINI_SAMPLE, 'typescript');
    const match = detections.find(d => d.service === 'openai');
    expect(match).toBeDefined();
    expect(match!.model).toBe('gpt-4o-mini');
    expect(match!.outputTokens).toBe(500);
  });
});

describe('analyzeCode — Anthropic', () => {
  it('detects claude-3-5-sonnet messages.create call', () => {
    const { detections } = analyzeCode(ANTHROPIC_SAMPLE, 'typescript');
    const match = detections.find(d => d.service === 'anthropic');
    expect(match).toBeDefined();
    expect(match!.model).toBe('claude-3-5-sonnet');
    expect(match!.outputTokens).toBe(1024);
  });
});

describe('analyzeCode — AWS Lambda', () => {
  it('detects InvokeCommand usage', () => {
    const { detections } = analyzeCode(LAMBDA_SAMPLE, 'typescript');
    const match = detections.find(d => d.service === 'aws-lambda');
    expect(match).toBeDefined();
    expect(match!.operation).toBe('invoke');
  });
});

describe('analyzeCode — DynamoDB', () => {
  it('detects GetItemCommand usage', () => {
    const { detections } = analyzeCode(DYNAMODB_SAMPLE, 'typescript');
    const match = detections.find(d => d.service === 'dynamodb');
    expect(match).toBeDefined();
    expect(match!.operation).toBe('read');
  });
});

describe('analyzeCode — S3', () => {
  it('detects GetObjectCommand usage', () => {
    const { detections } = analyzeCode(S3_SAMPLE, 'typescript');
    const match = detections.find(d => d.service === 's3');
    expect(match).toBeDefined();
    expect(match!.operation).toBe('get');
  });
});

describe('analyzeCode — Redis', () => {
  it('detects redis.get call', () => {
    const { detections } = analyzeCode(REDIS_SAMPLE, 'typescript');
    const match = detections.find(d => d.service === 'redis');
    expect(match).toBeDefined();
  });
});

describe('analyzeCode — Edge cases', () => {
  it('returns empty detections for plain JS math', () => {
    const { detections } = analyzeCode(PLAIN_SAMPLE, 'typescript');
    expect(detections).toHaveLength(0);
  });

  it('handles multi-service code and detects all services', () => {
    const { detections } = analyzeCode(MULTI_SERVICE_SAMPLE, 'typescript');
    const services = new Set(detections.map(d => d.service));
    expect(services.has('openai')).toBe(true);
    expect(services.has('redis')).toBe(true);
    expect(services.has('aws-lambda')).toBe(true);
  });

  it('returns error (not throw) for unsupported language', () => {
    const result = analyzeCode('print("hello")', 'python');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.detections).toHaveLength(0);
  });

  it('returns parse error for invalid syntax without throwing', () => {
    const result = analyzeCode('const x = {{{broken', 'typescript');
    expect(result.errors.some(e => e.includes('parse error'))).toBe(true);
    expect(result.detections).toHaveLength(0);
  });
});
