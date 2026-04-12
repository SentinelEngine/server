/**
 * Azure Real-Time Analytics Platform
 *
 * IoT sensor data ingestion & alerting pipeline:
 *  - Azure Blob Storage for raw sensor dumps
 *  - Azure Cosmos DB for device state & time-series
 *  - Azure Functions (HTTP trigger) for ingest API
 *  - OpenAI GPT-4 for anomaly summarisation
 *  - Redis (Azure Cache) for rate-limiting & live dashboard
 *
 * CloudCost Lens will flag: Cosmos DB RU/s consumption,
 * Blob write throughput, OpenAI token burn rate, Redis memory.
 */

import { BlobServiceClient }   from '@azure/storage-blob';
import { CosmosClient }        from '@azure/cosmos';
import { createClient }        from 'redis';
import OpenAI                  from 'openai';

const blobService = BlobServiceClient.fromConnectionString(
  process.env.AZURE_STORAGE_CONNECTION_STRING!,
);

const cosmos = new CosmosClient({ endpoint: process.env.COSMOS_ENDPOINT!, key: process.env.COSMOS_KEY! });
const db     = cosmos.database('SensorDB');

const redis  = createClient({ url: process.env.REDIS_URL });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

await redis.connect();

// ─── Ingest raw sensor payload ──────────────────────────────────────────────

export async function ingestSensorBatch(
  deviceId: string,
  readings: Array<{ timestamp: string; metric: string; value: number }>,
): Promise<void> {
  // 1. Write raw JSON to Azure Blob Storage (cold archive)
  const container   = blobService.getContainerClient('sensor-raw');
  const blobName    = `${deviceId}/${new Date().toISOString().slice(0, 10)}/${Date.now()}.json`;
  const blobClient  = container.getBlockBlobClient(blobName);

  await blobClient.uploadData(Buffer.from(JSON.stringify(readings)), {
    blobHTTPHeaders: { blobContentType: 'application/json' },
    metadata:        { deviceId, count: String(readings.length) },
  });

  // 2. Upsert latest device state into Cosmos DB
  const deviceContainer = db.container('DeviceState');
  await deviceContainer.items.upsert({
    id:          deviceId,
    deviceId,
    lastSeen:    readings.at(-1)?.timestamp ?? new Date().toISOString(),
    latestValues: Object.fromEntries(readings.map(r => [r.metric, r.value])),
    _partitionKey: deviceId,
  });

  // 3. Fan-out time-series writes (one doc per reading)
  const tsContainer = db.container('TimeSeries');
  await Promise.all(
    readings.map(r =>
      tsContainer.items.create({
        id:           `${deviceId}-${r.timestamp}-${r.metric}`,
        deviceId,
        timestamp:    r.timestamp,
        metric:       r.metric,
        value:        r.value,
        _partitionKey: deviceId,
      }),
    ),
  );

  // 4. Cache latest values in Redis for live dashboard (TTL: 60s)
  await redis.setEx(`device:latest:${deviceId}`, 60, JSON.stringify(readings.at(-1)));
  await redis.lPush(`device:history:${deviceId}`, JSON.stringify(readings.at(-1)));
  await redis.lTrim(`device:history:${deviceId}`, 0, 99); // keep last 100
}

// ─── Detect anomalies with OpenAI ───────────────────────────────────────────

export async function detectAndSummariseAnomalies(
  deviceId: string,
  windowMinutes = 15,
): Promise<{ anomalies: boolean; summary: string }> {
  // Pull recent readings from Cosmos DB
  const tsContainer = db.container('TimeSeries');
  const cutoff      = new Date(Date.now() - windowMinutes * 60_000).toISOString();

  const { resources } = await tsContainer.items
    .query({
      query: `
        SELECT c.timestamp, c.metric, c.value
        FROM   c
        WHERE  c.deviceId = @deviceId
          AND  c.timestamp >= @cutoff
        ORDER BY c.timestamp DESC
        OFFSET 0 LIMIT 200
      `,
      parameters: [
        { name: '@deviceId', value: deviceId },
        { name: '@cutoff',   value: cutoff },
      ],
    })
    .fetchAll();

  // Ask GPT-4o to detect anomalies in the window
  const response = await openai.chat.completions.create({
    model:  'gpt-4o',
    messages: [
      {
        role:    'system',
        content: 'You are an IoT anomaly detection expert. Analyse sensor readings and return JSON: { anomalies: boolean, severity: "low"|"medium"|"high", summary: string, affectedMetrics: string[] }',
      },
      {
        role:    'user',
        content: `Device: ${deviceId}\nTime window: last ${windowMinutes} minutes\nReadings:\n${JSON.stringify(resources, null, 2)}`,
      },
    ],
    max_tokens:      512,
    response_format: { type: 'json_object' },
  });

  const analysis = JSON.parse(response.choices[0].message.content ?? '{}');

  // Cache anomaly status in Redis
  await redis.setEx(`device:anomaly:${deviceId}`, 300, JSON.stringify(analysis));

  // If high severity, write an alert document to Cosmos DB
  if (analysis.severity === 'high') {
    const alertContainer = db.container('Alerts');
    await alertContainer.items.create({
      id:              `alert-${deviceId}-${Date.now()}`,
      deviceId,
      triggeredAt:     new Date().toISOString(),
      severity:        analysis.severity,
      affectedMetrics: analysis.affectedMetrics,
      summary:         analysis.summary,
      _partitionKey:    deviceId,
    });
  }

  return { anomalies: analysis.anomalies, summary: analysis.summary };
}

// ─── Live dashboard data (served from Redis) ─────────────────────────────────

export async function getDashboardSnapshot(deviceIds: string[]): Promise<Record<string, unknown>> {
  const pipeline = redis.multi();

  for (const id of deviceIds) {
    pipeline.get(`device:latest:${id}`);
    pipeline.get(`device:anomaly:${id}`);
    pipeline.lRange(`device:history:${id}`, 0, 9);
  }

  const results = await pipeline.exec();
  const snapshot: Record<string, unknown> = {};

  deviceIds.forEach((id, i) => {
    const base   = i * 3;
    snapshot[id] = {
      latest:   results[base]   ? JSON.parse(results[base] as string)   : null,
      anomaly:  results[base+1] ? JSON.parse(results[base+1] as string) : null,
      history:  (results[base+2] as string[] ?? []).map(r => JSON.parse(r)),
    };
  });

  return snapshot;
}

// ─── Archive old blobs to cool tier ─────────────────────────────────────────

export async function archiveOldReadings(olderThanDays = 30): Promise<number> {
  const container = blobService.getContainerClient('sensor-raw');
  const cutoff    = new Date(Date.now() - olderThanDays * 86400_000);
  let   archived  = 0;

  for await (const blob of container.listBlobsFlat({ includeMetadata: true })) {
    if (blob.properties.lastModified && blob.properties.lastModified < cutoff) {
      const client = container.getBlobClient(blob.name);
      // Move to Cool tier (cheaper storage, higher access cost)
      await (client as any).setAccessTier('Cool');
      archived++;
    }
  }

  return archived;
}
