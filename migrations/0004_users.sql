-- Migration 0004: Google OAuth users table
-- Run: psql $DATABASE_URL -f migrations/0004_users.sql

CREATE TABLE IF NOT EXISTS users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_id    TEXT UNIQUE NOT NULL,
  email        TEXT NOT NULL,
  display_name TEXT,
  avatar_url   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_google_id_idx ON users (google_id);
