-- Migration: Add blockchain audit tables
-- Run: npm run migrate

CREATE TABLE IF NOT EXISTS audit_reports (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   TEXT        NOT NULL,
  file_path    TEXT        NOT NULL,
  author       TEXT        NOT NULL DEFAULT 'unknown',
  report_json  JSONB       NOT NULL,
  hash         TEXT        NOT NULL,
  tx_hash      TEXT        NOT NULL DEFAULT 'not-anchored',
  explorer_url TEXT        NOT NULL DEFAULT '',
  anchored     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pr_diffs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_id        TEXT        NOT NULL,
  pr_title     TEXT        NOT NULL DEFAULT '',
  author       TEXT        NOT NULL DEFAULT 'unknown',
  diff_json    JSONB       NOT NULL,
  hash         TEXT        NOT NULL,
  tx_hash      TEXT        NOT NULL DEFAULT 'not-anchored',
  explorer_url TEXT        NOT NULL DEFAULT '',
  anchored     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_reports_project_id ON audit_reports (project_id);
CREATE INDEX IF NOT EXISTS idx_audit_reports_created_at ON audit_reports (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pr_diffs_pr_id           ON pr_diffs (pr_id);
