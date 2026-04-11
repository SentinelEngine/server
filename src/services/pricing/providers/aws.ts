import { getCachedPricing, setCachedPricing } from '../cache.js';

export interface LambdaPricing {
  perRequest:  number; // USD per request
  perGbSecond: number; // USD per GB-second of compute
  freeRequests: number;
  freeGbSeconds: number;
}

export interface DynamoDBPricing {
  perReadUnit:  number; // USD per RCU
  perWriteUnit: number; // USD per WCU
  perGbStorage: number; // USD per GB/month
}

export interface S3Pricing {
  perGbStorage:   number; // USD per GB/month (standard)
  perGetRequest:  number; // USD per 1,000 GET requests
  perPutRequest:  number; // USD per 1,000 PUT/COPY/POST/LIST
  perGbTransfer:  number; // USD per GB data transfer out
}

export interface ApiGatewayPricing {
  perMillionRequests: number; // USD per 1M API calls (REST)
  perMillionWsMessages: number; // USD per 1M WebSocket messages
  connectionMinutePrice: number; // USD per connection-minute
}

export interface AWSPricing {
  lambda:     LambdaPricing;
  dynamodb:   DynamoDBPricing;
  s3:         S3Pricing;
  apiGateway: ApiGatewayPricing;
}

const STATIC_PRICING: AWSPricing = {
  lambda: {
    perRequest:    0.0000002,   // $0.20 per 1M requests
    perGbSecond:   0.0000166667, // $0.0000166667 per GB-second
    freeRequests:  1_000_000,
    freeGbSeconds: 400_000,
  },
  dynamodb: {
    perReadUnit:  0.0000001, // $0.25 per 1M RCUs → $0.00000025
    perWriteUnit: 0.00000125, // $1.25 per 1M WCUs
    perGbStorage: 0.25,      // $0.25/GB/month
  },
  s3: {
    perGbStorage:  0.023,    // $0.023 per GB/month (standard)
    perGetRequest: 0.0004,   // $0.0004 per 1,000 GETs
    perPutRequest: 0.005,    // $0.005 per 1,000 PUTs
    perGbTransfer: 0.09,     // $0.09 per GB transfer out
  },
  apiGateway: {
    perMillionRequests:    3.50, // $3.50 per 1M REST API calls
    perMillionWsMessages:  1.00, // $1.00 per 1M WebSocket messages
    connectionMinutePrice: 0.00025, // $0.25 per million connection-minutes
  },
};

export async function fetchAWSPricing(): Promise<AWSPricing> {
  const cacheKey = 'aws:all';
  const cached = await getCachedPricing<AWSPricing>(cacheKey);
  if (cached) return cached;

  // AWS Pricing API requires SigV4 auth; we use static pricing with periodic
  // manual update. Cache the static data to maintain TTL parity.
  await setCachedPricing(cacheKey, STATIC_PRICING);
  return STATIC_PRICING;
}
