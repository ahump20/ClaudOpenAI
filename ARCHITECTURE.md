# ClaudOpenAI — Architecture

> Companion to [README.md](./README.md). Deep design reference for implementers and agents.

## System topology

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ UPSTREAM REPOS (9, verified Spike S1)                                       │
│                                                                             │
│  anthropics/claude-plugins-official  (Tier B — license check per file)      │
│  anthropics/skills                   (Tier B — 115K ⭐)                     │
│  anthropics/knowledge-work-plugins   (Tier A — Apache 2.0, 11K ⭐)           │
│  openai/codex                        (Tier A — Apache 2.0, 74K ⭐)           │
│  openai/codex-plugin-cc              (Tier A — Apache 2.0, bridge prior art)│
│  openai/skills                       (Tier B — 16K ⭐)                      │
│  openai/swarm                        (Tier C — dormant, 13mo stale)         │
│  openai/openai-agents-python         (Tier A — MIT, 20K ⭐)                  │
│  openai/plugins                      (Tier B — hosts the 16 openai-curated) │
│                                                                             │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ git ls-remote / sparse-clone (free quota)
                                   ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ CLOUDFLARE WORKER: universal-skills-indexer                                 │
│ indexer.marketplace.blazesportsintel.com                                    │
│                                                                             │
│ cron = "0 */6 * * *"  (every 6h)                                            │
│ Secret: GITHUB_TOKEN (fine-grained PAT, public-repo read)                   │
│                                                                             │
│  For each upstream:                                                         │
│    1. git ls-remote HEAD SHA                                                │
│    2. Compare to D1.sources.last_sync_sha                                   │
│    3. If changed: sparse-clone, walk, extract SKILL.md + plugin.json        │
│    4. For each file: frontmatter parse + translate → CanonicalSkill         │
│    5. sha256(canonical) vs D1.skills.content_hash → delta                   │
│    6. Changed: pack skill.md + refs.tgz → R2; UPSERT D1                     │
│    7. On rate-limit: checkpoint to KV INDEXER_STATE; resume next cycle      │
│                                                                             │
│  Bindings: DB (D1), CONTENT (R2), INDEXER_STATE (KV), GITHUB_TOKEN (secret)│
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ Workers RPC / direct D1 writes
                                   ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ STORAGE LAYER                                                               │
│                                                                             │
│  D1 `universal-skills`                                                      │
│    ├── skills (id PK, name, description, source_ecosystem,                  │
│    │           manifest_format, quality_score, content_hash, ...)           │
│    ├── skill_versions (skill_id FK, version, content_hash, indexed_at)      │
│    ├── skill_references (skill_id FK, ref_path, sha256, size_bytes)         │
│    ├── sources (name PK, repo_url, last_sync_sha, last_sync_at)             │
│    └── skills_fts (FTS5 virtual: id, name, description, tags)               │
│                                                                             │
│  R2 `universal-skills-content`                                              │
│    skills/{id}/{version}/skill.md                                           │
│    skills/{id}/{version}/references.tgz                                     │
│    skills/{id}/{version}/assets.tgz                                         │
│    skills/{id}/{version}/canonical.json                                     │
│                                                                             │
│  KV                                                                         │
│    CACHE          — LRU shadow for hot resolve-skill queries                │
│    RATE_LIMIT     — per-IP counters (API Worker)                            │
│    INDEXER_STATE  — per-source ETag + pagination cursors                    │
└────────────────────────┬─────────────────────────────────────┬──────────────┘
                         ↓                                     ↓
┌────────────────────────────────────────┐  ┌────────────────────────────────┐
│ WORKER: universal-skills-api           │  │ WORKER: universal-skills-bridge│
│ api.marketplace.blazesportsintel.com   │  │ registry.marketplace...com     │
│                                        │  │ marketplace.blazesportsintel...│
│ POST /mcp    JSON-RPC 2.0 MCP          │  │ GET /.claude-plugin/           │
│   tools/list → [3 tools]               │  │     marketplace.json           │
│   tools/call → resolve/get/install     │  │ GET /.agents/plugins/          │
│ GET  /health → {d1, r2, status}        │  │     marketplace.json           │
│                                        │  │ GET /.well-known/              │
│ Rate limit: 60 rpm/IP (KV RATE_LIMIT)  │  │     universal-skills.json      │
│ OAuth: optional (workers-oauth-        │  │ GET /health                    │
│         provider if we add auth later) │  │                                │
└────────────────────────────────────────┘  └────────────────────────────────┘
                         ↑                                     ↑
                         │                                     │
      ┌──────────────────┴─────────┐    ┌───────────────────────┴────────────┐
      │ CLIENT: Claude Code        │    │ CLIENT: OpenAI Codex               │
      │                            │    │                                    │
      │ ~/.claude/mcp.json:        │    │ ~/.codex/config.toml:              │
      │ {"universal-skills":       │    │ [mcp_servers.universal-skills]     │
      │  {"type":"http",           │    │ command = "npx"                    │
      │   "url":"api.market..."}}  │    │ args = ["-y","@bsi/u-s-mcp"]       │
      │                            │    │                                    │
      │ OR stdio via npx -y        │    │ OR /plugin install ClaudOpenAI     │
      └────────────────────────────┘    └────────────────────────────────────┘
                         │                                     │
                         └──────────────┬──────────────────────┘
                                        │
                        ┌───────────────┴───────────────┐
                        │ CLIENT: npm package local dev │
                        │ npx @blazesportsintel/u-s-mcp │
                        │   --transport stdio           │
                        │                               │
                        │ Phase 2: GitHubRegistry       │
                        │ Phase 3: HttpRegistry (→ api) │
                        └───────────────────────────────┘
```

## Data flow: a single `resolve-skill` call

1. User in Claude Code: *"find me a skill for PDF processing"*
2. Claude Code detects intent → invokes `mcp__universal-skills__resolve_skill(query="PDF processing")`
3. If `mcp.json` uses `type: "http"`: HTTPS POST to `api.marketplace.blazesportsintel.com/mcp`
4. Worker checks `KV CACHE` for recent identical query → miss
5. Worker queries `D1 skills_fts` with BM25 ranking on `(name, description, tags)`
6. Worker returns top 10 results with quality scores, source ecosystem, install commands for both ecosystems, `meta.fetched_at`
7. Worker writes result to `KV CACHE` with 10min TTL
8. User sees: "Found 7 PDF-processing skills. Top match: anthropics/skills/pdf (score 82, available in both ecosystems)."

## Data flow: a `get-skill-content` call (progressive disclosure)

1. User in Claude Code clicks install
2. `get-skill-content(id="anthropics/skills:pdf", include=["metadata","body"])` → returns SKILL.md parsed + frontmatter
3. User confirms
4. `install-skill(id="anthropics/skills:pdf", target="claude", mode="write-to-disk")` → Worker queries R2 for signed URL → returns `{ written: [...], target_dir: "~/.claude/skills/pdf/" }`
5. npm package (client-side) fetches the signed URL, unpacks, writes to disk
6. Next Claude Code restart: skill auto-discovers

## Translator: Claude ↔ Canonical ↔ Codex

Per [Plan Agent 2's manifest translator design](../../.claude/plans/zesty-growing-flurry.md#section-2--the-guidance-skill-package):

```
ClaudePlugin (plugin.json minimal + convention dirs)
    │
    │ toCanonical()
    ▼
CanonicalSkill (zod)
    │                                  ┌─> standalone SKILL.md (pass-through when 1 skill)
    │ fromCanonical(target=)           │
    ▼                                  │
CodexPlugin (plugin.json with interface{} + apps + keywords + license ...)
    │
    │ Sidecar + shims if lossy:
    │   .codex-plugin/claude_ecosystem.json   (on Codex→Claude)
    │   .claude-plugin/codex_ecosystem.json   (on Claude→Codex)
    │   HTML-comment shims in SKILL.md bodies
    │   agents/codex-apps.notes.md            (when .app.json had connector IDs)
    │
    ▼
translation_log: [ {level, field, message, shim_generated}, ... ]
```

Round-trip invariant: `fromCanonical(toCanonical(x), x.origin.type) === x` modulo declared lossy fields (recovered from sidecar on reverse direction).

## D1 schema (DDL lives in `schema/d1-schema.sql`)

See Plan Agent 1 Section 4 in the plan file. Highlights:

- Primary key `skills.id` in `{namespace}/{name}` form (e.g. `openai-curated/canva`)
- `skills_fts` FTS5 virtual table with content-sync triggers (ai / ad / au)
- Indexes on `quality_score DESC`, `source_ecosystem`, `last_verified` for common queries
- `tombstoned INTEGER NOT NULL DEFAULT 0` for soft-deletes when upstream removes a skill

## R2 key structure

Content-addressable by `{id}/{version}`:

```
skills/anthropics-skills/pdf/0.1.0/skill.md
skills/anthropics-skills/pdf/0.1.0/references.tgz
skills/anthropics-skills/pdf/0.1.0/assets.tgz
skills/anthropics-skills/pdf/0.1.0/canonical.json
skills/openai-curated/canva/1.0.0/skill.md
...
```

Cache-control: `public, max-age=86400, immutable` (safe — versioned).

## KV namespaces

| Namespace | Worker | Keys | TTL |
|-----------|--------|------|-----|
| `CACHE` | api | `resolve:{sha1(query+filters)}` | 600s |
| `RATE_LIMIT` | api | `{ip}` | 60s |
| `INDEXER_STATE` | indexer | `etag:{source}:{path}`, `cursor:{source}`, `ratelimit` | none (overwrites) |

## Deploy targets

| Resource | Name | URL |
|----------|------|-----|
| Worker (api) | `universal-skills-api` | `api.marketplace.blazesportsintel.com` |
| Worker (indexer) | `universal-skills-indexer` | `indexer.marketplace.blazesportsintel.com` (cron + admin only) |
| Worker (bridge) | `universal-skills-bridge` | `marketplace.blazesportsintel.com` + `registry.marketplace.blazesportsintel.com` |
| D1 | `universal-skills` | binding `DB` in all 3 Workers |
| R2 | `universal-skills-content` | binding `CONTENT` in api + indexer |
| KV | `CACHE`, `RATE_LIMIT`, `INDEXER_STATE` | scoped per Worker |
| npm | `@blazesportsintel/universal-skills-mcp` | `npx -y @blazesportsintel/universal-skills-mcp` |

## Threat model (v0.1)

- **Trust**: We do NOT sign artifacts in v0.1. `provenance.signature_method = null` in canonical records. Users verify trust by the upstream repo URL (visible in every result).
- **Rate limit**: 60 rpm/IP. Sufficient for conversational use; insufficient for scraping (acceptable).
- **Data leaks**: No user data stored. Query strings cached in KV `CACHE` for 10min (privacy-acceptable).
- **Malicious skills**: Not v0.1's problem. `install-skill` with `mode=command-only` (default) emits a command; user runs it deliberately. `mode=write-to-disk` only writes to `~/.claude/skills/` or `~/.codex/skills/` — same dirs users write to manually.

v0.2 will add: cosign/Sigstore keyless signing, static analysis of SKILL.md bodies for obvious tells (embedded URLs in `allowed-tools`, etc.), install-count-weighted trust scoring.

## See also

- [Plan file](../../.claude/plans/zesty-growing-flurry.md) — full project plan
- [docs/spikes/](./docs/spikes/) — Phase 0 research outputs (all 7 spikes)
- [skills/universal-skills-marketplace/references/](./skills/universal-skills-marketplace/references/) — deep design references (Phase 1 output, 12 files)
