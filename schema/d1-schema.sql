-- ClaudOpenAI D1 schema
-- Version: 0.1.0
-- Author: Austin Humphrey / Blaze Sports Intel
-- See: skills/universal-skills-marketplace/references/06-d1-schema-design.md

-- ============================================
-- skills: primary catalog
-- ============================================
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  source_ecosystem TEXT NOT NULL CHECK(source_ecosystem IN ('claude','codex','universal')),
  source_url TEXT NOT NULL,
  source_repo TEXT NOT NULL,
  source_commit TEXT NOT NULL,
  source_path TEXT NOT NULL,
  manifest_format TEXT NOT NULL CHECK(manifest_format IN ('claude-plugin','codex-plugin','standalone-skill','openai-agent')),
  quality_score INTEGER NOT NULL DEFAULT 0 CHECK(quality_score BETWEEN 0 AND 100),
  install_count INTEGER NOT NULL DEFAULT 0,
  star_count INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL,
  compat_claude INTEGER NOT NULL DEFAULT 0 CHECK(compat_claude IN (0,1)),
  compat_codex INTEGER NOT NULL DEFAULT 0 CHECK(compat_codex IN (0,1)),
  tags TEXT,                                       -- JSON array as string
  category TEXT,
  last_verified TEXT NOT NULL,                     -- ISO 8601
  indexed_at TEXT NOT NULL,                        -- ISO 8601
  tombstoned INTEGER NOT NULL DEFAULT 0 CHECK(tombstoned IN (0,1))
);

CREATE INDEX IF NOT EXISTS idx_skills_score ON skills(quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_skills_ecosystem ON skills(source_ecosystem, tombstoned);
CREATE INDEX IF NOT EXISTS idx_skills_last_verified ON skills(last_verified DESC);
CREATE INDEX IF NOT EXISTS idx_skills_source_repo ON skills(source_repo);
CREATE INDEX IF NOT EXISTS idx_skills_content_hash ON skills(content_hash);

-- ============================================
-- skill_versions: version history
-- ============================================
CREATE TABLE IF NOT EXISTS skill_versions (
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source_commit TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  PRIMARY KEY(skill_id, version)
);

CREATE INDEX IF NOT EXISTS idx_skill_versions_skill ON skill_versions(skill_id, indexed_at DESC);

-- ============================================
-- skill_references: referenced file metadata
-- ============================================
CREATE TABLE IF NOT EXISTS skill_references (
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  ref_path TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('reference','script','asset')),
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mime TEXT NOT NULL,
  PRIMARY KEY(skill_id, version, ref_path)
);

CREATE INDEX IF NOT EXISTS idx_skill_references_skill ON skill_references(skill_id, version);

-- ============================================
-- sources: upstream repo state (indexer's internal table)
-- ============================================
CREATE TABLE IF NOT EXISTS sources (
  name TEXT PRIMARY KEY,
  repo_url TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  last_sync_sha TEXT,
  last_sync_at TEXT,
  last_check_at TEXT,
  last_result TEXT CHECK(last_result IS NULL OR last_result IN ('ok','rate_limited','error','unchanged')),
  error_message TEXT,
  priority_tier TEXT NOT NULL CHECK(priority_tier IN ('A','B','C')),
  poll_interval_seconds INTEGER NOT NULL
);

-- ============================================
-- skills_fts: full-text search (FTS5 virtual table)
-- ============================================
CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(
  id UNINDEXED,
  name,
  description,
  tags,
  category,
  content='skills',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

-- Content-sync triggers (FTS5 "external content" pattern)
CREATE TRIGGER IF NOT EXISTS skills_ai AFTER INSERT ON skills BEGIN
  INSERT INTO skills_fts(rowid, id, name, description, tags, category)
  VALUES (new.rowid, new.id, new.name, new.description, new.tags, new.category);
END;

CREATE TRIGGER IF NOT EXISTS skills_ad AFTER DELETE ON skills BEGIN
  INSERT INTO skills_fts(skills_fts, rowid, id, name, description, tags, category)
  VALUES('delete', old.rowid, old.id, old.name, old.description, old.tags, old.category);
END;

CREATE TRIGGER IF NOT EXISTS skills_au AFTER UPDATE ON skills BEGIN
  INSERT INTO skills_fts(skills_fts, rowid, id, name, description, tags, category)
  VALUES('delete', old.rowid, old.id, old.name, old.description, old.tags, old.category);
  INSERT INTO skills_fts(rowid, id, name, description, tags, category)
  VALUES (new.rowid, new.id, new.name, new.description, new.tags, new.category);
END;

-- ============================================
-- Initial source records (per Spike S1)
-- ============================================
INSERT OR IGNORE INTO sources (name, repo_url, default_branch, priority_tier, poll_interval_seconds) VALUES
  ('anthropics/claude-plugins-official', 'https://github.com/anthropics/claude-plugins-official', 'main', 'B', 21600),
  ('anthropics/skills', 'https://github.com/anthropics/skills', 'main', 'B', 21600),
  ('anthropics/knowledge-work-plugins', 'https://github.com/anthropics/knowledge-work-plugins', 'main', 'A', 21600),
  ('openai/codex', 'https://github.com/openai/codex', 'main', 'A', 21600),
  ('openai/codex-plugin-cc', 'https://github.com/openai/codex-plugin-cc', 'main', 'A', 21600),
  ('openai/skills', 'https://github.com/openai/skills', 'main', 'B', 21600),
  ('openai/swarm', 'https://github.com/openai/swarm', 'main', 'C', 86400),
  ('openai/openai-agents-python', 'https://github.com/openai/openai-agents-python', 'main', 'A', 21600),
  ('openai/plugins', 'https://github.com/openai/plugins', 'main', 'B', 21600);
