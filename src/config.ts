import { z } from 'zod';
import 'dotenv/config';

const EnvSchema = z.object({
  NODE_ENV:           z.enum(['development', 'test', 'production']).default('development'),
  PORT:               z.coerce.number().default(3001),
  HOST:               z.string().default('0.0.0.0'),
  DATABASE_URL:       z.string().url(),
  REDIS_URL:          z.string().url().default('redis://localhost:6379'),
  JWT_SECRET:         z.string().min(32),
  OPENAI_API_KEY:     z.string().optional(),
  ANTHROPIC_API_KEY:  z.string().optional(),
  AWS_PRICING_REGION: z.string().default('us-east-1'),
  PRICING_TTL_SECS:   z.coerce.number().default(3600),
  MAX_FILE_SIZE_KB:   z.coerce.number().default(500),
  RATE_LIMIT_MAX:     z.coerce.number().default(100),
  RATE_LIMIT_WINDOW:  z.string().default('1 minute'),
  LOG_LEVEL:          z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
});

export const config = EnvSchema.parse(process.env);
export type Config = z.infer<typeof EnvSchema>;
