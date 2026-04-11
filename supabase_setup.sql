-- ════════════════════════════════════════════════
-- LUMEO AI v3.0 — Supabase Schema
-- EMEMZYVISUALS DIGITALS | Emmanuel.A
-- Run this in Supabase SQL Editor
-- ════════════════════════════════════════════════

-- User profiles
CREATE TABLE IF NOT EXISTS lumeo_users (
  phone         TEXT PRIMARY KEY,
  name          TEXT,
  language      TEXT DEFAULT 'english',
  persona       TEXT DEFAULT 'casual',
  notes         TEXT DEFAULT '',
  warnings      INTEGER DEFAULT 0,
  banned        BOOLEAN DEFAULT FALSE,
  ban_reason    TEXT,
  message_count INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Conversation memory
CREATE TABLE IF NOT EXISTS lumeo_memory (
  id         BIGSERIAL PRIMARY KEY,
  phone      TEXT NOT NULL,
  role       TEXT NOT NULL,  -- 'user' | 'assistant'
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lumeo_memory_phone_time ON lumeo_memory(phone, created_at DESC);

-- Key-value brain store
CREATE TABLE IF NOT EXISTS lumeo_brain (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Marketing campaigns
CREATE TABLE IF NOT EXISTS lumeo_campaigns (
  id           BIGSERIAL PRIMARY KEY,
  project      TEXT,
  target_type  TEXT,
  sent         INTEGER DEFAULT 0,
  failed       INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Disable Row Level Security (bot uses service key) ────────────────────────
ALTER TABLE lumeo_users     DISABLE ROW LEVEL SECURITY;
ALTER TABLE lumeo_memory    DISABLE ROW LEVEL SECURITY;
ALTER TABLE lumeo_brain     DISABLE ROW LEVEL SECURITY;
ALTER TABLE lumeo_campaigns DISABLE ROW LEVEL SECURITY;
