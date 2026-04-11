import { pgTable, uuid, text, jsonb, timestamp, integer } from 'drizzle-orm/pg-core';

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
