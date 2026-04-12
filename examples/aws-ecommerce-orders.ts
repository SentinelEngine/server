/**
 * AWS E-Commerce Order Processing System
 *
 * Serverless checkout pipeline:
 *  - API Gateway receives checkout requests
 *  - Lambda validates inventory and charges Stripe
 *  - DynamoDB stores orders and inventory
 *  - S3 stores generated PDF invoices
 *  - OpenAI generates personalized recommendation emails
 *
 * CloudCost Lens will flag: high DynamoDB write throughput,
 * Lambda cold-start risks, S3 storage growth, OpenAI token spend.
 */

import AWS from 'aws-sdk';
import Anthropic from '@anthropic-ai/sdk';

const s3       = new AWS.S3({ region: 'us-east-1' });
const dynamo   = new AWS.DynamoDB.DocumentClient({ region: 'us-east-1' });
const lambda   = new AWS.Lambda({ region: 'us-east-1' });
const claude   = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Place an order ─────────────────────────────────────────────────────────

export async function placeOrder(order: {
  userId:     string;
  items:      Array<{ sku: string; qty: number; priceUsd: number }>;
  shippingAddress: Record<string, string>;
}): Promise<{ orderId: string; invoiceUrl: string }> {
  const orderId = `ORD-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

  // 1. Write order to DynamoDB (primary table + analytics GSI)
  await dynamo.transactWrite({
    TransactItems: [
      {
        Put: {
          TableName:           'Orders',
          ConditionExpression: 'attribute_not_exists(orderId)',
          Item: {
            orderId,
            userId:          order.userId,
            items:           order.items,
            totalUsd:        order.items.reduce((s, i) => s + i.priceUsd * i.qty, 0),
            status:          'pending',
            shippingAddress: order.shippingAddress,
            createdAt:       new Date().toISOString(),
          },
        },
      },
      // Decrement inventory counts for each SKU
      ...order.items.map(item => ({
        Update: {
          TableName:                 'Inventory',
          Key:                       { sku: item.sku },
          UpdateExpression:          'SET stock = stock - :qty',
          ConditionExpression:       'stock >= :qty',
          ExpressionAttributeValues: { ':qty': item.qty },
        },
      })),
    ],
  }).promise();

  // 2. Invoke Lambda to generate PDF invoice asynchronously
  await lambda.invoke({
    FunctionName:   'acme-invoice-generator',
    InvocationType: 'Event',
    Payload:        JSON.stringify({ orderId, userId: order.userId }),
  }).promise();

  // 3. Get signed S3 URL for future download
  const invoiceKey = `invoices/${order.userId}/${orderId}.pdf`;
  const invoiceUrl = s3.getSignedUrl('getObject', {
    Bucket:  'acme-orders-invoices',
    Key:     invoiceKey,
    Expires: 86400, // 24 hours
  });

  return { orderId, invoiceUrl };
}

// ─── Generate AI-powered recommendation email ────────────────────────────────

export async function generateRecommendationEmail(
  userId:       string,
  recentOrders: Array<{ items: Array<{ sku: string; name: string }> }>,
): Promise<string> {
  // Fetch user profile from DynamoDB
  const profile = await dynamo.get({
    TableName: 'UserProfiles',
    Key:       { userId },
  }).promise();

  const userName   = (profile.Item?.name as string) ?? 'Valued Customer';
  const purchasedSkus = recentOrders.flatMap(o => o.items.map(i => i.name)).join(', ');

  // Generate personalized email with Claude
  const message = await claude.messages.create({
    model:      'claude-3-5-sonnet-20241022',
    max_tokens: 1024,
    messages: [{
      role:    'user',
      content: `Write a personalized HTML recommendation email for ${userName}.
Their recent purchases: ${purchasedSkus}.
Include 3 product recommendations, a 10% discount code, and a friendly CTA.
Format: valid HTML fragment (no <html>/<body> wrapper).`,
    }],
  });

  const htmlEmail = (message.content[0] as { text: string }).text;

  // Store generated email in S3 for audit
  await s3.putObject({
    Bucket:      'acme-email-templates',
    Key:         `personalized/${userId}/${Date.now()}.html`,
    Body:        htmlEmail,
    ContentType: 'text/html',
  }).promise();

  return htmlEmail;
}

// ─── Order analytics scan ────────────────────────────────────────────────────

export async function getDailyRevenue(date: string): Promise<number> {
  // Full table scan filtered by date — expensive on large tables!
  const result = await dynamo.scan({
    TableName:        'Orders',
    FilterExpression: 'begins_with(createdAt, :date) AND #s = :status',
    ExpressionAttributeNames:  { '#s': 'status' },
    ExpressionAttributeValues: { ':date': date, ':status': 'completed' },
    ProjectionExpression:      'orderId, totalUsd',
  }).promise();

  return (result.Items ?? []).reduce((sum, row) => sum + (row.totalUsd as number), 0);
}

// ─── Batch-upload product images ─────────────────────────────────────────────

export async function bulkUploadProductImages(
  products: Array<{ sku: string; imageBuffer: Buffer; contentType: string }>,
): Promise<void> {
  await Promise.all(
    products.map(p =>
      s3.putObject({
        Bucket:               'acme-product-images',
        Key:                  `catalog/${p.sku}/hero.jpg`,
        Body:                 p.imageBuffer,
        ContentType:          p.contentType,
        CacheControl:         'max-age=31536000',
        StorageClass:         'INTELLIGENT_TIERING',
      }).promise(),
    ),
  );

  // Update DynamoDB with new image URLs
  await Promise.all(
    products.map(p =>
      dynamo.update({
        TableName:                 'Inventory',
        Key:                       { sku: p.sku },
        UpdateExpression:          'SET imageUrl = :url, updatedAt = :t',
        ExpressionAttributeValues: {
          ':url': `https://acme-product-images.s3.amazonaws.com/catalog/${p.sku}/hero.jpg`,
          ':t':   new Date().toISOString(),
        },
      }).promise(),
    ),
  );
}
