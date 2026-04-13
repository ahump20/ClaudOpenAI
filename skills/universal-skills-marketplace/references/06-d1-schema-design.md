# 06 — D1 Schema Design

SQLite-flavored schema for the `universal-skills` D1 database. Five tables + one FTS5 virtual table + sync triggers + query-optimized indexes. DDL at [`schema/d1-schema.sql`](../../../schema/d1-schema.sql) (authored in Phase 1-P1-2).

## Tables

### `skills` — primary catalog

```sql
CREATE TABLE skills (
  id TEXT PRIMARY KEY,                             -- "{namespace}/{name}", e.g. "anthropics-skills/pdf"
  name TEXT NOT NULL,                              -- kebab-case plugin/skill name
  description TEXT NOT NULL,
  source_ecosystem TEXT NOT NULL CHECK(source_ecosystem IN ('claude','codex','universal')),
  source_url TEXT NOT NULL,                        -- GitHub blob URL pinned to commit SHA
  source_repo TEXT NOT NULL,                       -- "owner/name"
  source_commit TEXT NOT NULL,                     -- 40-char sha
  source_path TEXT NOT NULL,                       -- "plugins/foo/skills/bar" relative to repo root
  manifest_format TEXT NOT NULL CHECK(manifest_format IN ('claude-plugin','codex-plugin','standalone-skill')),
  quality_score INTEGER NOT NULL DEFAULT 0 CHECK(quality_score BETWEEN 0 AND 100),
  install_count INTEGER NOT NULL DEFAULT 0,
  star_count INTEGER NOT NULL DEFAULT 0,           -- from upstream repo, not skill-level
  content_hash TEXT NOT NULL,                      -- sha256 of canonical JSON
  compat_claude INTEGER NOT NULL DEFAULT 0,        -- 0/1 boolean
  compat_codex INTEGER NOT NULL DEFAULT 0,
  tags TEXT,                                       -- JSON array: ["pdf","extraction","parsing"]
  category TEXT,                                   -- Codex-style; e.g. "Coding", "Productivity"
  last_verified TEXT NOT NULL,                     -- ISO 8601
  indexed_at TEXT NOT NULL,
  tombstoned INTEGER NOT NULL DEFAULT 0 CHECK(tombstoned IN (0,1))
);
```

- `id` = "{namespace}/{name}" where namespace dedupes across sources (e.g. `anthropics-skills/pdf` vs `openai-skills/pdf`)
- `source_commit` enables reproducible reference — every result includes the exact commit SHA the skill was indexed at
- `content_hash` is sha256 of the **canonical JSON** excluding `content_hash`, `last_verified`, `install_count` (the volatile fields). Used for delta indexing.
- `tombstoned=1` = upstream deleted the skill; kept in DB for install-count history; excluded from API results.

### `skill_versions` — version history

```sql
CREATE TABLE skill_versions (
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  version TEXT NOT NULL,                           -- semver from SKILL.md frontmatter or plugin.json
  content_hash TEXT NOT NULL,
  source_commit TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  PRIMARY KEY(skill_id, version)
);

CREATE INDEX idx_skill_versions_skill ON skill_versions(skill_id, indexed_at DESC);
```

Every re-index of a skill that produces a different `content_hash` inserts a new row. Allows rollback to prior versions via `get-skill-content(id, version=...)`.

### `skill_references` — referenced file metadata

```sql
CREATE TABLE skill_references (
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  ref_path TEXT NOT NULL,                          -- e.g. "references/00-architecture.md"
  kind TEXT NOT NULL CHECK(kind IN ('reference','script','asset')),
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mime TEXT NOT NULL,
  PRIMARY KEY(skill_id, version, ref_path)
);

CREATE INDEX idx_skill_references_skill ON skill_references(skill_id, version);
```

Enables fast `get-skill-content(include=["references"])` queries — we know what references exist before reading R2.

### `sources` — upstream repo state

```sql
CREATE TABLE sources (
  name TEXT PRIMARY KEY,                           -- e.g. "anthropics/claude-plugins-official"
  repo_url TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  last_sync_sha TEXT,                              -- last fully-indexed commit
  last_sync_at TEXT,                               -- ISO 8601
  last_check_at TEXT,                              -- even when no change
  last_result TEXT CHECK(last_result IN ('ok','rate_limited','error','unchanged')),
  error_message TEXT,                              -- null unless last_result='error'
  priority_tier TEXT NOT NULL CHECK(priority_tier IN ('A','B','C')),
  poll_interval_seconds INTEGER NOT NULL           -- A=21600 (6h), B=21600, C=86400 (24h)
);
```

Indexer reads this to decide what to poll each cycle. Observability endpoint exposes it via bridge worker's `/_admin/sources` (post-MVP).

### `skills_fts` — full-text search virtual

```sql
CREATE VIRTUAL TABLE skills_fts USING fts5(
  id UNINDEXED,
  name,
  description,
  tags,
  category,
  content='skills',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

-- Content-sync triggers (FTS external content pattern)
CREATE TRIGGER skills_ai AFTER INSERT ON skills BEGIN
  INSERT INTO skills_fts(rowid, id, name, description, tags, category)
  VALUES (new.rowid, new.id, new.name, new.description, new.tags, new.category);
END;

CREATE TRIGGER skills_ad AFTER DELETE ON skills BEGIN
  INSERT INTO skills_fts(skills_fts, rowid, id, name, description, tags, category)
  VALUES('delete', old.rowid, old.id, old.name, old.description, old.tags, old.category);
END;

CREATE TRIGGER skills_au AFTER UPDATE ON skills BEGIN
  INSERT INTO skills_fts(skills_fts, rowid, id, name, description, tags, category)
  VALUES('delete', old.rowid, old.id, old.name, old.description, old.tags, old.category);
  INSERT INTO skills_fts(rowid, id, name, description, tags, category)
  VALUES (new.rowid, new.id, new.name, new.description, new.tags, new.category);
END;
```

`porter` tokenizer enables stemming (matches "processing" against "process"). `unicode61` handles non-ASCII text correctly.

## Indexes

```sql
CREATE INDEX idx_skills_score ON skills(quality_score DESC);
CREATE INDEX idx_skills_ecosystem ON skills(source_ecosystem, tombstoned);
CREATE INDEX idx_skills_last_verified ON skills(last_verified DESC);
CREATE INDEX idx_skills_source_repo ON skills(source_repo);
CREATE INDEX idx_skills_content_hash ON skills(content_hash);  -- for delta detection
```

## Query patterns

### resolve-skill (ranked FTS search)

```sql
SELECT
  s.id,
  s.name,
  s.description,
  s.quality_score,
  s.source_ecosystem,
  s.source_url,
  s.source_repo,
  s.compat_claude,
  s.compat_codex,
  s.content_hash,
  s.last_verified,
  bm25(skills_fts) AS rank
FROM skills s
JOIN skills_fts fts ON s.rowid = fts.rowid
WHERE skills_fts MATCH ?                      -- query string, e.g. 'pdf AND process*'
  AND s.tombstoned = 0
  AND s.quality_score >= ?                    -- min_quality filter
  AND (? = 'any' OR s.source_ecosystem = ?)   -- ecosystem filter
  AND (? IS NULL OR s.category = ?)           -- category filter
  AND (? IS NULL OR s.source_repo = ?)        -- source_repo filter
ORDER BY rank                                 -- BM25 ranks ASC (lower = better)
LIMIT ?;
```

Note: `bm25()` requires FTS5 extension (available in D1). Lower rank = better match. Can also use `rank * (100 - quality_score)/100.0` to blend quality weighting.

### get-skill-content metadata-only

```sql
SELECT
  s.id, s.name, s.description, s.version, s.source_url, s.quality_score,
  s.content_hash,
  sv.version, sv.indexed_at
FROM skills s
LEFT JOIN skill_versions sv ON s.id = sv.skill_id AND sv.version = COALESCE(?, (
  SELECT version FROM skill_versions WHERE skill_id = s.id ORDER BY indexed_at DESC LIMIT 1
))
WHERE s.id = ? AND s.tombstoned = 0;
```

### get-skill-content reference list

```sql
SELECT ref_path, kind, sha256, size_bytes, mime
FROM skill_references
WHERE skill_id = ? AND version = ?
ORDER BY kind, ref_path;
```

### Bridge: Claude marketplace.json plugin list

```sql
SELECT id, name, description, source_url, source_commit, quality_score
FROM skills
WHERE tombstoned = 0
  AND manifest_format IN ('claude-plugin', 'standalone-skill')  -- render as Claude-installable
  AND quality_score >= 30
ORDER BY quality_score DESC, name
LIMIT 200;
```

Bridge renderer translates this into Claude marketplace.json's `plugins` array shape.

### Bridge: Codex marketplace.json plugin list

```sql
SELECT id, name, description, source_url, source_commit, quality_score, category
FROM skills
WHERE tombstoned = 0
  AND manifest_format IN ('codex-plugin', 'standalone-skill')
  AND quality_score >= 30
ORDER BY quality_score DESC, name
LIMIT 200;
```

## Indexer UPSERT pattern

```sql
INSERT INTO skills (id, name, description, source_ecosystem, source_url, source_repo,
                    source_commit, source_path, manifest_format, quality_score,
                    content_hash, compat_claude, compat_codex, tags, category,
                    last_verified, indexed_at, tombstoned)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  description = excluded.description,
  source_url = excluded.source_url,
  source_commit = excluded.source_commit,
  source_path = excluded.source_path,
  manifest_format = excluded.manifest_format,
  quality_score = excluded.quality_score,
  content_hash = excluded.content_hash,
  compat_claude = excluded.compat_claude,
  compat_codex = excluded.compat_codex,
  tags = excluded.tags,
  category = excluded.category,
  last_verified = excluded.last_verified,
  indexed_at = excluded.indexed_at,
  tombstoned = 0
WHERE skills.content_hash != excluded.content_hash;  -- only write on change
```

The `WHERE ... != excluded.content_hash` makes the UPDATE a no-op when nothing changed — cheap and safe.

## Delta-detection flow

```ts
async function upsertSkill(db: D1Database, canonical: CanonicalSkill, hash: string) {
  const existing = await db.prepare(`SELECT content_hash FROM skills WHERE id = ?`)
    .bind(canonical.id).first<{ content_hash: string } | null>();

  if (existing?.content_hash === hash) {
    // No change; just bump last_verified
    await db.prepare(`UPDATE skills SET last_verified = ? WHERE id = ?`)
      .bind(new Date().toISOString(), canonical.id).run();
    return { changed: false };
  }

  // Changed — UPSERT and append version row
  await db.batch([
    db.prepare(`INSERT OR REPLACE INTO skills (...) VALUES (...)`).bind(...),
    db.prepare(`INSERT INTO skill_versions (skill_id, version, content_hash, source_commit, indexed_at)
                VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).bind(...)
  ]);
  return { changed: true };
}
```

## Migrations

Store migrations in `schema/migrations/NNNN_description.sql`. Apply ordered:

```bash
for f in schema/migrations/*.sql; do
  wrangler d1 execute universal-skills --file="$f"
done
```

Track applied migrations in a `schema_migrations` table (not yet implemented; add when we have the first migration).

## Local development

Use an in-memory SQLite with the same schema for tests:

```ts
import Database from "better-sqlite3";
const db = new Database(":memory:");
db.exec(readFileSync("schema/d1-schema.sql", "utf8"));
// Tests run against db; D1 and better-sqlite3 share FTS5 + SQL syntax
```

## Size estimates

- ~10,000 skills long-term upper bound (currently ~50 in installed catalogs)
- Avg `skills` row: ~500 bytes → 5 MB at 10k skills
- `skill_versions` ~100 bytes × 3 versions avg × 10k skills = 3 MB
- `skill_references` ~150 bytes × 20 refs avg × 10k skills = 30 MB
- `skills_fts` external content: ~1-2× size of indexed columns

Well within D1's 10GB free-tier limit.

## Backup / recovery

D1 has daily snapshots (Cloudflare backend). Manual backup:

```bash
wrangler d1 export universal-skills --output=backup-$(date +%Y%m%d).sql --local=false --remote=true
```

Restore: apply the export SQL to a new D1 DB via `wrangler d1 execute`.

## See also

- [`schema/d1-schema.sql`](../../../schema/d1-schema.sql) — full DDL (authored Phase 1-P1-2)
- [`07-r2-storage-patterns.md`](07-r2-storage-patterns.md) — content bytes live in R2, metadata in D1
- [`08-github-indexer-design.md`](08-github-indexer-design.md) — upstream → D1 flow
- [`04-mcp-tool-design.md`](04-mcp-tool-design.md) — tools that query this schema
