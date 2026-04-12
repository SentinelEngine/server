/**
 * AWS Financial Risk Engine
 *
 * Real-time fraud detection and risk scoring for a fintech app:
 *  - API Gateway → Lambda for transaction intake
 *  - DynamoDB for transaction ledger + user risk profiles
 *  - Redis for sliding-window rate detection (velocity checks)
 *  - OpenAI for natural-language fraud report generation
 *  - S3 for compliance audit log storage
 *
 * ⚠ CloudCost Lens will highlight:
 *   - DynamoDB: heavy scan on TransactionLedger (no GSI on amount)
 *   - Lambda: synchronous invocation adds latency + cost
 *   - OpenAI: gpt-4o called per flagged transaction (could batch)
 *   - Redis: sorted-set ops per transaction (memory intensive)
 */

import AWS    from 'aws-sdk';
import OpenAI from 'openai';
import { createClient } from 'redis';

const s3     = new AWS.S3({ region: 'us-east-1' });
const dynamo = new AWS.DynamoDB.DocumentClient({ region: 'us-east-1' });
const lambda = new AWS.Lambda({ region: 'us-east-1' });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const redis  = createClient({ url: process.env.REDIS_URL });

await redis.connect();

export interface Transaction {
  txId:        string;
  userId:      string;
  amountUsd:   number;
  merchantId:  string;
  countryCode: string;
  timestamp:   string;
  channel:     'web' | 'mobile' | 'atm' | 'pos';
}

// ─── Ingest and score a transaction ─────────────────────────────────────────

export async function processTransaction(tx: Transaction): Promise<{
  approved: boolean;
  riskScore: number;
  flags: string[];
}> {
  const flags: string[] = [];
  let   riskScore = 0;

  // 1. Velocity check via Redis sorted sets (transactions per 1-min window)
  const windowKey = `velocity:${tx.userId}:${Math.floor(Date.now() / 60_000)}`;
  const txCount   = await redis.zCard(windowKey);
  await redis.zAdd(windowKey, [{ score: Date.now(), value: tx.txId }]);
  await redis.expire(windowKey, 120);

  if (txCount > 5)  { flags.push('HIGH_VELOCITY'); riskScore += 30; }
  if (txCount > 15) { flags.push('EXTREME_VELOCITY'); riskScore += 50; }

  // 2. Amount threshold check vs user's 30-day average (DynamoDB)
  const profile = await dynamo.get({
    TableName: 'UserRiskProfiles',
    Key:       { userId: tx.userId },
  }).promise();

  const avgSpend = (profile.Item?.avgMonthlySpendUsd as number) ?? 500;
  if (tx.amountUsd > avgSpend * 3) { flags.push('UNUSUAL_AMOUNT'); riskScore += 25; }

  // 3. Country mismatch check (Redis geo-cache)
  const lastCountry = await redis.get(`user:country:${tx.userId}`);
  if (lastCountry && lastCountry !== tx.countryCode) {
    flags.push('COUNTRY_MISMATCH');
    riskScore += 35;
  }
  await redis.setEx(`user:country:${tx.userId}`, 3600, tx.countryCode);

  // 4. Write transaction to DynamoDB ledger
  await dynamo.put({
    TableName: 'TransactionLedger',
    Item: {
      ...tx,
      riskScore,
      flags,
      approved: riskScore < 60,
    },
  }).promise();

  // 5. If high-risk → invoke Lambda synchronously for deep ML scoring
  if (riskScore >= 40) {
    const mlResult = await lambda.invoke({
      FunctionName:   'acme-ml-fraud-scorer',
      InvocationType: 'RequestResponse',  // synchronous — adds latency!
      Payload:        JSON.stringify({ tx, flags, riskScore }),
    }).promise();

    const mlScore = JSON.parse(mlResult.Payload as string);
    riskScore     = Math.max(riskScore, mlScore.adjustedScore ?? riskScore);
  }

  // 6. If flagged → generate fraud report with OpenAI + archive to S3
  if (riskScore >= 60) {
    await generateFraudReport(tx, flags, riskScore);
  }

  return { approved: riskScore < 60, riskScore, flags };
}

// ─── Generate AI fraud report ────────────────────────────────────────────────

async function generateFraudReport(
  tx:        Transaction,
  flags:     string[],
  riskScore: number,
): Promise<void> {
  // GPT-4o generates a compliance-ready report
  const completion = await openai.chat.completions.create({
    model:  'gpt-4o',
    messages: [{
      role:    'user',
      content: `Generate a formal fraud investigation report for the following transaction:
Transaction ID: ${tx.txId}
User: ${tx.userId}
Amount: $${tx.amountUsd.toFixed(2)}
Merchant: ${tx.merchantId}
Country: ${tx.countryCode}
Channel: ${tx.channel}
Timestamp: ${tx.timestamp}
Risk Score: ${riskScore}/100
Triggered Flags: ${flags.join(', ')}

Include: executive summary, risk breakdown, recommended action (block/review/allow), and next steps.`,
    }],
    max_tokens: 1024,
  });

  const report = completion.choices[0].message.content ?? '';

  // Archive to S3 for regulatory compliance (7-year retention)
  await s3.putObject({
    Bucket:              'acme-fraud-reports',
    Key:                 `reports/${new Date().toISOString().slice(0, 7)}/${tx.txId}.txt`,
    Body:                report,
    ContentType:         'text/plain',
    StorageClass:        'STANDARD_IA',
    ObjectLockMode:      'COMPLIANCE',
    ObjectLockRetainUntilDate: new Date(Date.now() + 7 * 365 * 86400_000),
  }).promise();

  // Update DynamoDB with report reference
  await dynamo.update({
    TableName:               'TransactionLedger',
    Key:                     { txId: tx.txId },
    UpdateExpression:        'SET fraudReportKey = :k, reviewRequired = :r',
    ExpressionAttributeValues: {
      ':k': `reports/${new Date().toISOString().slice(0, 7)}/${tx.txId}.txt`,
      ':r': true,
    },
  }).promise();
}

// ─── Compliance batch export ─────────────────────────────────────────────────

export async function exportFlaggedTransactions(month: string): Promise<string> {
  // Monthly full-table scan → expensive for millions of transactions!
  const result = await dynamo.scan({
    TableName:        'TransactionLedger',
    FilterExpression: 'begins_with(#ts, :month) AND riskScore >= :threshold',
    ExpressionAttributeNames:  { '#ts': 'timestamp' },
    ExpressionAttributeValues: { ':month': month, ':threshold': 60 },
  }).promise();

  const csv = [
    'txId,userId,amountUsd,riskScore,flags,approved',
    ...(result.Items ?? []).map((r: any) =>
      `${r.txId},${r.userId},${r.amountUsd},${r.riskScore},"${r.flags?.join('|') ?? ''}",${r.approved}`,
    ),
  ].join('\n');

  // Upload export to S3
  const exportKey = `exports/${month}/flagged-transactions.csv`;
  await s3.putObject({
    Bucket:      'acme-fraud-reports',
    Key:         exportKey,
    Body:        csv,
    ContentType: 'text/csv',
  }).promise();

  return s3.getSignedUrl('getObject', {
    Bucket:  'acme-fraud-reports',
    Key:     exportKey,
    Expires: 3600,
  });
}
