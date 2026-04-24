/**
 * TEST FILE 5: Multi-Service Stack (OpenAI + Anthropic + S3 + Lambda + DynamoDB)
 * Expected CloudGauge output:
 *   openai/gpt-4o          →  $875.00/mo   (50k loop calls)
 *   anthropic/claude-3-sonnet → $412.50/mo (50k loop calls)
 *   s3/put                 →    $1.23/mo   (200k ops)
 *   aws-lambda             →    $0.00/mo   (within free tier)
 *   dynamodb/write         →    $6.25/mo   (50k writes)
 *   TOTAL: ~$1,295/mo | Criticality: 🔴 MAJOR
 *
 * This is the most realistic production architecture test.
 */
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";

const openai    = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const s3        = new S3Client({ region: "us-east-1" });
const lambda    = new LambdaClient({ region: "us-east-1" });
const dynamo    = new DynamoDBClient({ region: "us-east-1" });

export async function fullPipelineProcess(documents) {
  for (let i = 0; i < documents.length; i++) {
    // 1. OpenAI GPT-4o extraction (in loop → 50k calls/mo)
    const extraction = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: `Extract key data from: ${documents[i]}` }],
      max_tokens: 1000,
    });

    // 2. Anthropic Claude-3-Sonnet analysis (in loop → 50k calls/mo)
    const analysis = await anthropic.messages.create({
      model: "claude-3-sonnet-20240229",
      max_tokens: 1000,
      messages: [{ role: "user", content: `Analyze extracted data: ${extraction.choices[0].message.content}` }],
    });

    // 3. Store result in S3 (in loop → 200k ops/mo)
    await s3.send(new PutObjectCommand({
      Bucket: "pipeline-results",
      Key:    `doc-${i}.json`,
      Body:   JSON.stringify({ extraction: extraction.choices[0], analysis: analysis.content[0] }),
    }));

    // 4. Trigger downstream Lambda (in loop)
    await lambda.send(new InvokeCommand({
      FunctionName: "process-document",
      Payload:      JSON.stringify({ docId: i }),
    }));

    // 5. Save metadata to DynamoDB (in loop → 50k writes/mo)
    await dynamo.send(new PutItemCommand({
      TableName: "document-metadata",
      Item: {
        docId:     { S: String(i) },
        status:    { S: "processed" },
        timestamp: { S: new Date().toISOString() },
      },
    }));
  }
}
