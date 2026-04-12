/**
 * Multi-Cloud AI Chatbot with RAG (Retrieval Augmented Generation)
 *
 * Production chatbot backend used by a SaaS product:
 *  - S3 / Blob Storage for document corpus
 *  - DynamoDB for conversation history & user sessions
 *  - Redis for semantic cache (avoid duplicate LLM calls)
 *  - OpenAI Embeddings + GPT-4 for RAG pipeline
 *  - Claude 3.5 Sonnet for long-context summarization
 *  - API Gateway WebSocket for streaming responses
 *
 * CloudCost Lens will catch: the expensive embedding calls on
 * every message, uncached LLM responses, DynamoDB hot partitions,
 * and Redis memory usage from large embedding vectors.
 */

import AWS      from 'aws-sdk';
import OpenAI   from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from 'redis';

const s3     = new AWS.S3({ region: 'us-east-1' });
const dynamo = new AWS.DynamoDB.DocumentClient({ region: 'us-east-1' });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const redis  = createClient({ url: process.env.REDIS_URL });

await redis.connect();

// ─── Embed a user query ─────────────────────────────────────────────────────

async function embedQuery(text: string): Promise<number[]> {
  // Check Redis semantic cache first (key = hash of text)
  const cacheKey = `embed:${Buffer.from(text).toString('base64').slice(0, 40)}`;
  const cached   = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  // OpenAI Embeddings API — charged per token
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-large',
    input: text,
    dimensions: 1536,
  });

  const vector = response.data[0].embedding;

  // Cache for 1 hour — saves repeated embedding costs
  await redis.setEx(cacheKey, 3600, JSON.stringify(vector));

  return vector;
}

// ─── Retrieve relevant documents from S3 corpus ─────────────────────────────

async function retrieveContext(
  queryVector: number[],
  topK = 5,
): Promise<string[]> {
  // List document index from DynamoDB
  const index = await dynamo.scan({
    TableName:            'DocumentIndex',
    ProjectionExpression: 'docId, s3Key, embeddingVector, chunkText',
  }).promise();

  // Cosine similarity in-process (would normally use a vector DB)
  const docs = (index.Items ?? []) as Array<{
    docId: string; s3Key: string; embeddingVector: number[]; chunkText: string;
  }>;

  const scored = docs
    .map(doc => ({
      ...doc,
      score: cosineSimilarity(queryVector, doc.embeddingVector),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored.map(d => d.chunkText);
}

function cosineSimilarity(a: number[], b: number[]): number {
  const dot  = a.reduce((s, v, i) => s + v * b[i], 0);
  const magA = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const magB = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
  return dot / (magA * magB);
}

// ─── RAG chat turn ───────────────────────────────────────────────────────────

export async function chat(
  sessionId: string,
  userId:    string,
  userMessage: string,
): Promise<{ reply: string; tokensUsed: number }> {
  // 1. Load conversation history from DynamoDB (last 10 turns)
  const histResult = await dynamo.query({
    TableName:              'ConversationHistory',
    KeyConditionExpression: 'sessionId = :sid',
    ExpressionAttributeValues: { ':sid': sessionId },
    ScanIndexForward:       false,
    Limit:                  10,
  }).promise();

  const history = ((histResult.Items ?? []) as Array<{ role: string; content: string }>)
    .reverse()
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  // 2. Embed query and retrieve relevant context
  const queryVector = await embedQuery(userMessage);
  const contextDocs = await retrieveContext(queryVector);
  const contextText = contextDocs.join('\n\n---\n\n');

  // 3. GPT-4o for the core RAG response
  const completion = await openai.chat.completions.create({
    model:  'gpt-4o',
    messages: [
      {
        role:    'system',
        content: `You are a helpful assistant. Use the following retrieved context to answer accurately.\n\nCONTEXT:\n${contextText}`,
      },
      ...history,
      { role: 'user', content: userMessage },
    ],
    max_tokens:   1024,
    temperature:  0.3,
    stream:       false,
  });

  const reply      = completion.choices[0].message.content ?? '';
  const tokensUsed = completion.usage?.total_tokens ?? 0;

  // 4. Persist both turns to DynamoDB
  const now = new Date().toISOString();
  await dynamo.transactWrite({
    TransactItems: [
      {
        Put: {
          TableName: 'ConversationHistory',
          Item: { sessionId, timestamp: `${now}-user`, role: 'user', content: userMessage, userId },
        },
      },
      {
        Put: {
          TableName: 'ConversationHistory',
          Item: { sessionId, timestamp: `${now}-assistant`, role: 'assistant', content: reply, tokensUsed },
        },
      },
    ],
  }).promise();

  // 5. Update session metadata in Redis (live user count, rate limiting)
  await redis.hSet(`session:${sessionId}`, {
    lastActive: now,
    msgCount:   await redis.hIncrBy(`session:${sessionId}`, 'msgCount', 1),
    userId,
  });
  await redis.expire(`session:${sessionId}`, 1800); // 30-min session TTL

  return { reply, tokensUsed };
}

// ─── Long document summarisation with Claude ─────────────────────────────────

export async function summariseDocument(s3Key: string): Promise<string> {
  // Fetch raw document from S3
  const obj    = await s3.getObject({ Bucket: 'acme-corpus', Key: s3Key }).promise();
  const text   = obj.Body?.toString('utf-8') ?? '';

  // Cache check
  const cacheKey = `summary:${s3Key.replace(/\//g, '_')}`;
  const cached   = await redis.get(cacheKey);
  if (cached) return cached;

  // Claude 3.5 Sonnet — long context, cheaper than GPT-4 for big docs
  const message = await claude.messages.create({
    model:      'claude-3-5-sonnet-20241022',
    max_tokens: 2048,
    messages: [{
      role:    'user',
      content: `Summarise the following document in clear, concise bullet points. Focus on key facts, costs, and action items.\n\nDOCUMENT:\n${text}`,
    }],
  });

  const summary = (message.content[0] as { text: string }).text;

  // Cache summary for 24 hours & store in DynamoDB
  await Promise.all([
    redis.setEx(cacheKey, 86400, summary),
    dynamo.put({
      TableName: 'DocumentSummaries',
      Item:      { s3Key, summary, generatedAt: new Date().toISOString() },
    }).promise(),
  ]);

  return summary;
}

// ─── Index a new document ────────────────────────────────────────────────────

export async function indexDocument(
  docId:   string,
  s3Key:   string,
  chunks:  string[],  // pre-chunked text segments
): Promise<void> {
  // Embed all chunks — this is where costs spike for large documents!
  const embeddings = await Promise.all(
    chunks.map(async (chunk, i) => {
      const vector = await embedQuery(chunk);
      return { docId, chunkIndex: i, s3Key, embeddingVector: vector, chunkText: chunk };
    }),
  );

  // Batch-write all chunk embeddings to DynamoDB
  const batchSize = 25; // DynamoDB batch limit
  for (let i = 0; i < embeddings.length; i += batchSize) {
    const batch = embeddings.slice(i, i + batchSize);
    await dynamo.batchWrite({
      RequestItems: {
        DocumentIndex: batch.map(item => ({ PutRequest: { Item: item } })),
      },
    }).promise();
  }
}
