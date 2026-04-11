import { pgTable, uuid, text, jsonb, timestamp, integer, boolean } from 'drizzle-orm/pg-core';

// ── Users (Google OAuth) ──────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id:          uuid('id').primaryKey().defaultRandom(),
  googleId:    text('google_id').unique().notNull(),
  email:       text('email').notNull(),
  displayName: text('display_name'),
  avatarUrl:   text('avatar_url'),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
});

export const analyses = pgTable('analyses', {
  id:           uuid('id').primaryKey().defaultRandom(),
  userId:       text('user_id').notNull(),
  fileName:     text('file_name').notNull(),
  language:     text('language').notNull(),
  codeHash:     text('code_hash').notNull(),
  detections:   jsonb('detections').notNull(),
  totalMonthly: integer('total_monthly_cents').notNull(),
  breakdown:    jsonb('breakdown').notNull(),
  createdAt:    timestamp('created_at').defaultNow().notNull(),
});

export const costDiffs = pgTable('cost_diffs', {
  id:             uuid('id').primaryKey().defaultRandom(),
  userId:         text('user_id').notNull(),
  prNumber:       integer('pr_number'),
  baseBranchHash: text('base_branch_hash').notNull(),
  headBranchHash: text('head_branch_hash').notNull(),
  deltaMonthly:   integer('delta_monthly_cents').notNull(),
  diffPayload:    jsonb('diff_payload').notNull(),
  createdAt:      timestamp('created_at').defaultNow().notNull(),
});

export const pricingSnapshots = pgTable('pricing_snapshots', {
  id:          uuid('id').primaryKey().defaultRandom(),
  service:     text('service').notNull(),
  model:       text('model'),
  pricingData: jsonb('pricing_data').notNull(),
  fetchedAt:   timestamp('fetched_at').defaultNow().notNull(),
});

// ── Blockchain Audit Tables ──────────────────────────────────────────────────

export const auditReports = pgTable('audit_reports', {
  id:          uuid('id').primaryKey().defaultRandom(),
  projectId:   text('project_id').notNull(),
  filePath:    text('file_path').notNull(),
  author:      text('author').notNull().default('unknown'),
  reportJson:  jsonb('report_json').notNull(),   // canonical JSON of the full report
  hash:        text('hash').notNull(),            // SHA-256 hex
  txHash:      text('tx_hash').notNull().default('not-anchored'),
  explorerUrl: text('explorer_url').notNull().default(''),
  anchored:    boolean('anchored').notNull().default(false),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
});

export const prDiffs = pgTable('pr_diffs', {
  id:          uuid('id').primaryKey().defaultRandom(),
  prId:        text('pr_id').notNull(),
  prTitle:     text('pr_title').notNull().default(''),
  author:      text('author').notNull().default('unknown'),
  diffJson:    jsonb('diff_json').notNull(),
  hash:        text('hash').notNull(),
  txHash:      text('tx_hash').notNull().default('not-anchored'),
  explorerUrl: text('explorer_url').notNull().default(''),
  anchored:    boolean('anchored').notNull().default(false),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
});
