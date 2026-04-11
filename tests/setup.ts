/**
 * Vitest global setup — sets required environment variables so that
 * src/config.ts can parse successfully in test context.
 * This runs before any test file is imported.
 */
process.env.DATABASE_URL  = process.env.DATABASE_URL  ?? 'postgres://ci:ci@localhost:5432/costanalyzer_test';
process.env.JWT_SECRET    = process.env.JWT_SECRET    ?? 'test_secret_key_at_least_32_chars_long!!';
process.env.REDIS_URL     = process.env.REDIS_URL     ?? 'redis://localhost:6379';
process.env.NODE_ENV      = 'test';
