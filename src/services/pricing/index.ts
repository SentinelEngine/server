/**
 * Unified pricing service — dispatches to the correct provider based on
 * service name and returns a normalised PricingResult.
 */
import { fetchOpenAIPricing }    from './providers/openai.js';
import { fetchAnthropicPricing } from './providers/anthropic.js';
import { fetchAWSPricing }       from './providers/aws.js';

export type { OpenAIPricing }    from './providers/openai.js';
export type { AnthropicPricing } from './providers/anthropic.js';
export type { AWSPricing }       from './providers/aws.js';

export interface ServicePricingResponse {
  service:   string;
  pricing:   unknown;
  source:    'live' | 'cache' | 'fallback';
  fetchedAt: string;
}

const SUPPORTED_SERVICES = ['openai', 'anthropic', 'aws-lambda', 'dynamodb', 's3', 'api-gateway', 'redis'] as const;
export type ServiceName = (typeof SUPPORTED_SERVICES)[number];

export async function getPricingForService(service: string): Promise<ServicePricingResponse> {
  const now = new Date().toISOString();

  switch (service) {
    case 'openai': {
      const pricing = await fetchOpenAIPricing();
      const hasFallback = Object.values(pricing).some(p => p.fetchedAt === 'fallback');
      return { service, pricing, source: hasFallback ? 'fallback' : 'live', fetchedAt: now };
    }
    case 'anthropic': {
      const pricing = await fetchAnthropicPricing();
      const hasFallback = Object.values(pricing).some(p => p.fetchedAt === 'fallback');
      return { service, pricing, source: hasFallback ? 'fallback' : 'live', fetchedAt: now };
    }
    case 'aws-lambda':
    case 'dynamodb':
    case 's3':
    case 'api-gateway': {
      const aws = await fetchAWSPricing();
      const key = service === 'aws-lambda' ? 'lambda'
                : service === 'api-gateway' ? 'apiGateway'
                : service as 'dynamodb' | 's3';
      return { service, pricing: (aws as any)[key], source: 'live', fetchedAt: now };
    }
    case 'redis': {
      // Redis (ElastiCache) pricing is complex and region-dependent; return placeholder
      return {
        service,
        pricing: { note: 'ElastiCache pricing varies by instance type and region. See https://aws.amazon.com/elasticache/pricing/' },
        source: 'fallback',
        fetchedAt: now,
      };
    }
    default:
      throw new Error(`Unsupported service: ${service}`);
  }
}

export { fetchOpenAIPricing, fetchAnthropicPricing, fetchAWSPricing };
