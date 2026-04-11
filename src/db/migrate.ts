/**
 * Migration runner — reads all *.sql files from migrations/ in lexicographic
 * order and executes them against the configured DATABASE_URL.
 *
 * Usage: npm run migrate  (or: tsx src/db/migrate.ts)
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

async function run(): Promise<void> {
  const pool = new Pool({ connectionString: config.DATABASE_URL });

  // Ensure tracking table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         SERIAL PRIMARY KEY,
      filename   TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const files = (await readdir(MIGRATIONS_DIR))
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const { rows } = await pool.query(
      'SELECT 1 FROM _migrations WHERE filename = $1',
      [file],
    );
    if (rows.length > 0) {
      console.log(`[migrate] Skipping ${file} (already applied)`);
      continue;
    }
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`[migrate] Applying ${file}...`);
    await pool.query(sql);
    await pool.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
    console.log(`[migrate] ✓ ${file}`);
  }

  await pool.end();
  console.log('[migrate] All migrations applied.');
}

run().catch(err => {
  console.error('[migrate] Fatal error:', err);
  process.exit(1);
});
