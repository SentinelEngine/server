/**
 * Shared code fixtures used across test suites.
 */

export const OPENAI_SAMPLE = [
  "import OpenAI from 'openai';",
  'const openai = new OpenAI();',
  'async function chat(msg: string) {',
  '  return openai.chat.completions.create({',
  "    model: 'gpt-4o',",
  "    messages: [{ role: 'user', content: msg }],",
  '    max_tokens: 2000,',
  '  });',
  '}',
].join('\n');

export const OPENAI_MINI_SAMPLE = [
  "import OpenAI from 'openai';",
  'const client = new OpenAI();',
  'const res = await client.chat.completions.create({',
  "  model: 'gpt-4o-mini',",
  '  messages: [],',
  '  max_tokens: 500,',
  '});',
].join('\n');

export const ANTHROPIC_SAMPLE = [
  "import Anthropic from '@anthropic-ai/sdk';",
  'const anthropic = new Anthropic();',
  'const msg = await anthropic.messages.create({',
  "  model: 'claude-3-5-sonnet',",
  "  max_tokens: 1024,",
  "  messages: [{ role: 'user', content: 'Hello' }],",
  '});',
].join('\n');

export const LAMBDA_SAMPLE = [
  "import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';",
  'const lambda = new LambdaClient({});',
  'const cmd = new InvokeCommand({ FunctionName: "myFn", Payload: Buffer.from("{}") });',
  'const result = await lambda.send(cmd);',
].join('\n');

export const DYNAMODB_SAMPLE = [
  "import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';",
  'const dynamoDBClient = new DynamoDBClient({});',
  "const cmd = new GetItemCommand({ TableName: 'users', Key: { id: { S: '1' } } });",
  'const result = await dynamoDBClient.send(cmd);',
].join('\n');

export const S3_SAMPLE = [
  "import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';",
  'const s3Client = new S3Client({});',
  "const cmd = new GetObjectCommand({ Bucket: 'my-bucket', Key: 'file.txt' });",
  'const result = await s3Client.send(cmd);',
].join('\n');

export const REDIS_SAMPLE = [
  "import { Redis } from 'ioredis';",
  'const redis = new Redis();',
  'async function get(key: string) {',
  '  const v = await redis.get(key);',
  '  return v ? JSON.parse(v) : null;',
  '}',
].join('\n');

export const PLAIN_SAMPLE = 'const x = 1 + 1;\nconsole.log(x);';

export const MULTI_SERVICE_SAMPLE = [
  OPENAI_SAMPLE,
  '',
  REDIS_SAMPLE,
  '',
  LAMBDA_SAMPLE,
].join('\n');
