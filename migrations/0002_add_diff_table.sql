-- Migration 0002: Add index on cost_diffs for PR number lookups
-- This migration is idempotent; applying it twice is safe.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'cost_diffs'
      AND indexname = 'idx_cost_diffs_pr_number'
  ) THEN
    CREATE INDEX idx_cost_diffs_pr_number ON cost_diffs(pr_number)
      WHERE pr_number IS NOT NULL;
  END IF;
END
$$;

-- Add optional snapshot_id foreign key to analyses for tracing which pricing
-- data was used at the time of analysis.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'analyses' AND column_name = 'pricing_snapshot_id'
  ) THEN
    ALTER TABLE analyses ADD COLUMN pricing_snapshot_id UUID REFERENCES pricing_snapshots(id) ON DELETE SET NULL;
  END IF;
END
$$;
