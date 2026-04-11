CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE analyses (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             TEXT NOT NULL,
  file_name           TEXT NOT NULL,
  language            TEXT NOT NULL,
  code_hash           TEXT NOT NULL,
  detections          JSONB NOT NULL DEFAULT '[]',
  total_monthly_cents INTEGER NOT NULL DEFAULT 0,
  breakdown           JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_analyses_user_id    ON analyses(user_id);
CREATE INDEX idx_analyses_created_at ON analyses(created_at DESC);

CREATE TABLE cost_diffs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             TEXT NOT NULL,
  pr_number           INTEGER,
  base_branch_hash    TEXT NOT NULL,
  head_branch_hash    TEXT NOT NULL,
  delta_monthly_cents INTEGER NOT NULL,
  diff_payload        JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cost_diffs_user_id ON cost_diffs(user_id);

CREATE TABLE pricing_snapshots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service      TEXT NOT NULL,
  model        TEXT,
  pricing_data JSONB NOT NULL,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pricing_service ON pricing_snapshots(service, fetched_at DESC);
