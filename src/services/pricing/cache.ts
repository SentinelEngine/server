import { Redis } from 'ioredis';
import { config } from '../../config.js';

let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 0,
      enableReadyCheck:     true,
      lazyConnect:          true,
      retryStrategy:        () => null // Stop retrying and don't spam reconnects
    });
    // Suppress the giant ECONNREFUSED error dump
    _redis.on('error', () => {});
  }
  return _redis;
}

export async function closeRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit();
    _redis = null;
  }
}

export async function getCachedPricing<T>(key: string): Promise<T | null> {
  try {
    const raw = await getRedis().get('pricing:' + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function setCachedPricing<T>(key: string, data: T): Promise<void> {
  try {
    await getRedis().setex('pricing:' + key, config.PRICING_TTL_SECS, JSON.stringify(data));
  } catch {
    // Non-fatal — continue without caching
  }
}
