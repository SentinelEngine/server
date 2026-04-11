import type { DetectorFn, DetectionMatch } from '../types.js';

/**
 * Detects Redis (ioredis / node-redis) operations.
 * Matches: redis.get / redis.set / redis.setex / client.get / redisClient.hget etc.
 */
const REDIS_PATTERNS =
  /(?:redis|redisClient|client)\.(get|set|setex|setnx|setpx|del|hget|hset|hmset|hmget|lpush|rpush|lrange|sadd|smembers|zadd|zrange|expire|ttl|exists|incr|decr|mget|mset|publish|subscribe)\s*\(/i;

export const redisDetector: DetectorFn = (ast, code) => {
  const matches: DetectionMatch[] = [];

  function walk(node: any): void {
    if (
      node.type === 'CallExpression' &&
      node.callee?.type === 'MemberExpression' &&
      node.range
    ) {
      const callStr = code.slice(node.range[0], node.range[1]);
      if (REDIS_PATTERNS.test(callStr)) {
        const isWrite = /set|del|push|add|expire|incr|decr|publish/i.test(callStr);
        matches.push({
          service:       'redis',
          operation:     isWrite ? 'write' : 'read',
          callsPerMonth: 1_000_000,
          line:          node.loc.start.line,
          column:        node.loc.start.column,
          snippet:       callStr.slice(0, 80),
        });
      }
    }

    for (const key of Object.keys(node)) {
      const child = (node as any)[key];
      if (child && typeof child === 'object') {
        if (Array.isArray(child)) child.forEach((c: any) => c?.type && walk(c));
        else if (child.type) walk(child);
      }
    }
  }

  walk(ast);
  return matches;
};
