/**
 * AWS Media Processing Pipeline
 * 
 * Real-world video transcoding pipeline that:
 *  - Accepts video uploads to S3
 *  - Triggers Lambda for frame extraction
 *  - Uses DynamoDB to track job state
 *  - Calls OpenAI Vision API for content moderation
 *  - Emits processed results via API Gateway WebSocket
 * 
 * CloudCost Lens will estimate: S3 storage + Lambda invocations +
 * DynamoDB reads/writes + OpenAI Vision tokens + API Gateway
 */

import AWS from 'aws-sdk';
import OpenAI from 'openai';

const s3     = new AWS.S3({ region: 'us-east-1' });
const dynamo = new AWS.DynamoDB.DocumentClient({ region: 'us-east-1' });
const lambda = new AWS.Lambda({ region: 'us-east-1' });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Upload raw video to S3 ─────────────────────────────────────────────────

export async function uploadRawVideo(
  jobId: string,
  videoBuffer: Buffer,
  mimeType: string,
): Promise<string> {
  const key = `raw/${jobId}/input.mp4`;

  await s3.putObject({
    Bucket:      'acme-media-uploads',
    Key:         key,
    Body:        videoBuffer,
    ContentType: mimeType,
    ServerSideEncryption: 'AES256',
    Metadata:    { jobId },
  }).promise();

  // Log job creation into DynamoDB
  await dynamo.put({
    TableName: 'MediaJobs',
    Item: {
      jobId,
      status:    'uploaded',
      s3Key:     key,
      createdAt: new Date().toISOString(),
      ttl:       Math.floor(Date.now() / 1000) + 7 * 86400, // 7-day TTL
    },
  }).promise();

  return key;
}

// ─── Trigger transcoding Lambda ─────────────────────────────────────────────

export async function triggerTranscode(jobId: string, s3Key: string): Promise<void> {
  const payload = JSON.stringify({ jobId, s3Key, targetFormats: ['720p', '1080p', '4k'] });

  await lambda.invoke({
    FunctionName:   'acme-video-transcoder',
    InvocationType: 'Event',          // async fire-and-forget
    Payload:        payload,
  }).promise();

  await dynamo.update({
    TableName: 'MediaJobs',
    Key:       { jobId },
    UpdateExpression: 'SET #s = :s, updatedAt = :t',
    ExpressionAttributeNames:  { '#s': 'status' },
    ExpressionAttributeValues: { ':s': 'transcoding', ':t': new Date().toISOString() },
  }).promise();
}

// ─── Content moderation via OpenAI Vision ──────────────────────────────────

export async function moderateFrames(
  jobId: string,
  frameKeys: string[],       // S3 keys of extracted frames
): Promise<{ safe: boolean; flaggedFrames: string[] }> {
  const flagged: string[] = [];

  // Process frames in batches of 10 (each call = 1 OpenAI API request)
  for (let i = 0; i < frameKeys.length; i += 10) {
    const batch = frameKeys.slice(i, i + 10);

    const imageContents = batch.map(key => ({
      type:      'image_url' as const,
      image_url: { url: `https://acme-media-uploads.s3.amazonaws.com/${key}` },
    }));

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Analyze these video frames for policy violations. Return JSON: { violations: string[], safe: boolean }',
          },
          ...imageContents,
        ],
      }],
      max_tokens:      512,
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(response.choices[0].message.content ?? '{}');
    if (!result.safe) flagged.push(...batch);
  }

  // Write moderation results to DynamoDB
  await dynamo.update({
    TableName: 'MediaJobs',
    Key:       { jobId },
    UpdateExpression: 'SET moderation = :m, #s = :s',
    ExpressionAttributeNames:  { '#s': 'status' },
    ExpressionAttributeValues: {
      ':m': { safe: flagged.length === 0, flaggedFrames: flagged },
      ':s': flagged.length > 0 ? 'flagged' : 'moderated',
    },
  }).promise();

  return { safe: flagged.length === 0, flaggedFrames: flagged };
}

// ─── Serve processed video from S3 signed URL ───────────────────────────────

export async function getDownloadUrl(jobId: string, resolution: '720p' | '1080p' | '4k'): Promise<string> {
  const key = `processed/${jobId}/${resolution}.mp4`;

  const url = s3.getSignedUrl('getObject', {
    Bucket:  'acme-media-processed',
    Key:     key,
    Expires: 3600,
  });

  // Record download in DynamoDB for analytics
  await dynamo.update({
    TableName: 'MediaJobs',
    Key:       { jobId },
    UpdateExpression: 'ADD downloadCount :one SET lastDownloadAt = :t',
    ExpressionAttributeValues: { ':one': 1, ':t': new Date().toISOString() },
  }).promise();

  return url;
}

// ─── Bulk analytics query ───────────────────────────────────────────────────

export async function getJobsByStatus(
  status: 'uploaded' | 'transcoding' | 'moderated' | 'flagged',
  limit = 100,
): Promise<Record<string, unknown>[]> {
  const result = await dynamo.query({
    TableName:              'MediaJobs',
    IndexName:              'status-createdAt-index',
    KeyConditionExpression: '#s = :s',
    ExpressionAttributeNames:  { '#s': 'status' },
    ExpressionAttributeValues: { ':s': status },
    ScanIndexForward:       false,
    Limit:                  limit,
  }).promise();

  return result.Items ?? [];
}
