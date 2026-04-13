# 00 — Architecture Overview

## Identity positioning

**ClaudOpenAI is an unofficial, independent, community project.** It is not affiliated with, endorsed by, or sponsored by Anthropic or OpenAI. "Claude Code," "Claude," "OpenAI Codex," and related names are trademarks of their respective owners. Every piece of UI, every README, every response produced by the MCP server must reinforce this.

Why: we're building a bridge that talks to both companies' products. It would be easy to inadvertently imply partnership. Don't. The `NOTICE` file at the repo root is the canonical statement.

## What we're building

A single MCP server that indexes skills and plugins from public repos in both ecosystems, normalizes them into a canonical JSON format, and serves them to any Claude Code or Codex session on demand. Plus a marketplace.json bridge that lets the same backend feed both ecosystems' catalog formats.

Think of it as [Context7](https://github.com/upstash/context7) but for skills instead of library docs. Same two-tool search-plus-fetch pattern; same open-to-every-MCP-client model; same "we don't own the data, we just organize it" philosophy.

## The problem we're solving

Claude Code and OpenAI Codex have **converged** on:
- The SKILL.md format (YAML frontmatter + markdown body + `references/` / `scripts/` / `assets/` progressive disclosure)
- MCP (Model Context Protocol) for tool extension
- The Apache/MIT open-source friendliness of their official repos

And **diverged** on:
- Plugin manifests: `.claude-plugin/plugin.json` (nearly-empty, convention-based) vs `.codex-plugin/plugin.json` (rich, with `interface{}` + `apps` + `keywords` + `license` fields)
- Marketplace catalogs: Claude's `marketplace.json` at `.claude-plugin/marketplace.json` vs Codex's at `.agents/plugins/marketplace.json`
- MCP transport defaults: Claude defaults to stdio via npx or remote HTTP; Codex's preferred transport still being verified (see Spike S4)
- `.mcp.json` shapes: Claude uses **flat** `{"<name>": {...}}`; Codex uses **wrapped** `{"mcpServers": {"<name>": {...}}}`

The result: a skill author has to publish twice, and a skill consumer can't find the other ecosystem's skills without manually browsing each repo. We're the bridge.

## System topology

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ UPSTREAM REPOS (9 — Tier A/B/C per docs/spikes/upstream-availability.md)    │
│                                                                             │
│  anthropics/claude-plugins-official   anthropics/skills                     │
│  anthropics/knowledge-work-plugins    openai/codex                          │
│  openai/codex-plugin-cc               openai/plugins                        │
│  openai/skills                        openai/swarm                          │
│  openai/openai-agents-python                                                │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ git ls-remote + sparse-clone (via GitHub CDN)
                                   ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ WORKER: universal-skills-indexer          cron = "0 */6 * * *"              │
│ indexer.marketplace.blazesportsintel.com                                    │
│                                                                             │
│  For each upstream:                                                         │
│    ls-remote → delta check → sparse-clone → walk → frontmatter parse →      │
│    translate → canonical JSON → sha256 → UPSERT D1 → R2 write               │
│                                                                             │
│  Bindings: DB (D1), CONTENT (R2), INDEXER_STATE (KV), GITHUB_TOKEN          │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│ STORAGE (see references/06-d1-schema-design.md + 07-r2-storage-patterns.md) │
│                                                                             │
│  D1 universal-skills       R2 universal-skills-content    KV (3 namespaces) │
│    skills                    skills/{id}/{ver}/skill.md     CACHE           │
│    skill_versions            skills/{id}/{ver}/refs.tgz     RATE_LIMIT      │
│    skill_references          skills/{id}/{ver}/assets.tgz   INDEXER_STATE   │
│    sources                   skills/{id}/{ver}/canonical.json               │
│    skills_fts (FTS5)                                                        │
└────────────────────────┬─────────────────────────────────────┬──────────────┘
                         ↓                                     ↓
      ┌─────────────────────────────┐            ┌─────────────────────────────┐
      │ WORKER: api                 │            │ WORKER: bridge              │
      │ api.marketplace.blaze...com │            │ marketplace.blaze...com     │
      │                             │            │ registry.marketplace.blaze..│
      │ POST /mcp  (JSON-RPC 2.0)   │            │ GET /.claude-plugin/        │
      │  tools/list → 3 tools       │            │     marketplace.json        │
      │  tools/call → search/get/   │            │ GET /.agents/plugins/       │
      │               install       │            │     marketplace.json        │
      │ GET  /health                │            │ GET /health                 │
      │                             │            │                             │
      │ 60 rpm/IP (KV)              │            │ read-only D1                │
      └──────────────┬──────────────┘            └──────────────┬──────────────┘
                     ↑                                          ↑
                     │                                          │
     ┌───────────────┴─────────────────┐      ┌─────────────────┴─────────────────┐
     │ CLAUDE CODE                     │      │ OPENAI CODEX                      │
     │ ~/.claude/mcp.json:             │      │ ~/.codex/config.toml:             │
     │ {"universal-skills":            │      │ [mcp_servers.universal-skills]    │
     │  {"type":"http","url":"api.."}  │      │ command = "npx"                   │
     │  OR {"command":"npx",...}}      │      │ args = ["-y","@bsi/u-s-mcp"]      │
     └─────────────────────────────────┘      └───────────────────────────────────┘
```

See [`../../../ARCHITECTURE.md`](../../../ARCHITECTURE.md) for the full-resolution diagram plus Mermaid source.

## Key architectural decisions

### 1. MCP server on Cloudflare Workers
Per canonical guidance in `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/mcp-server-dev/skills/build-mcp-server/SKILL.md`:
- Remote streamable-HTTP is the **default** deployment for any server wrapping a cloud API
- Cloudflare Workers is the **fastest** deploy path ("zero to live URL in two commands")
- stdio fallback via the npm package keeps offline/dev experience fast

We ship both: Workers remote + npx stdio, same 3-tool surface.

### 2. Trivial plugin wrapper + real npm package (Context7 pattern)
- `.claude-plugin/plugin.json`: 5 fields (name, description, author). That's it.
- `.codex-plugin/plugin.json`: richer (required by Codex schema), still no code.
- `.mcp.json`: just declares `npx -y @blazesportsintel/universal-skills-mcp`.
- Everything real lives in `packages/mcp-server/`.

Deviating from this (putting logic in the wrappers) means you got context7's lesson wrong. Re-read [`10-context7-architectural-analysis.md`](10-context7-architectural-analysis.md).

### 3. Canonical intermediate format
Translator operates `ClaudePlugin ↔ CanonicalSkill ↔ CodexPlugin`. Never directly `Claude ↔ Codex` — the canonical middle buys us:
- Symmetry (one schema to reason about)
- Version-ability (canonical version N can serve N-1 clients)
- Lossy-field tracking (lossy fields persist in `translation_log` + `ecosystem_extensions` regardless of direction)

Schema in `packages/schema/src/canonical.ts` (zod) and `schema/canonical-skill.schema.json` (JSON Schema).

### 4. Clone-and-walk indexer, not Code Search
GitHub Code Search is rate-limited (30 rpm authenticated). Sparse-cloning via the contents CDN is unmetered. Spike S3 documents the trade-off and math.

### 5. No signing in v0.1
`provenance.signature_method = null`. Trust model = "upstream repo URL visible in every result." v0.2 will add cosign/Sigstore keyless. Documented as non-goal; don't pretend otherwise.

## Data flow: one complete `resolve-skill` round-trip

1. User in Claude Code: *"find me a skill for PDF processing"*
2. Claude Code → `mcp__universal-skills__resolve_skill(query="PDF processing")`
3. Client sends JSON-RPC over HTTPS to `api.marketplace.blazesportsintel.com/mcp` (or stdio via npx to local server)
4. Worker checks `KV CACHE` key `resolve:{sha1(query+filters)}` → miss
5. Worker queries `D1 skills_fts` with BM25 ranking on `(name, description, tags)` filtered by `quality_score > 0`
6. Worker joins `skills_fts` results with `skills` + `skill_versions` for version + source info
7. Worker builds response array: `[{id, name, description, quality_score, source_ecosystem, source_url, compatibility, install_commands: {claude, codex}, content_hash, meta:{source, fetched_at}}, ...]`
8. Worker writes result to `KV CACHE` with 10min TTL
9. Client receives 7 results, displays top match: `anthropics/skills:pdf (score 82, available in both ecosystems)`

This sequence is what success looks like. Anything that diverges is a bug.

## Deployment targets

Enumerated in `ARCHITECTURE.md`. Briefly:

| Resource | Name |
|----------|------|
| Worker (api) | `universal-skills-api` @ `api.marketplace.blazesportsintel.com` |
| Worker (indexer) | `universal-skills-indexer` @ `indexer.marketplace.blazesportsintel.com` |
| Worker (bridge) | `universal-skills-bridge` @ `marketplace.blazesportsintel.com` + `registry.marketplace.blazesportsintel.com` |
| D1 | `universal-skills` |
| R2 | `universal-skills-content` |
| KV | `CACHE`, `RATE_LIMIT`, `INDEXER_STATE` |
| npm | `@blazesportsintel/universal-skills-mcp` |

DNS setup in [`docs/spikes/dns-setup.md`](../../../docs/spikes/dns-setup.md).

## What you should read next

Recommended order if you're implementing this skill (not just consuming it):

1. This file (done)
2. [`10-context7-architectural-analysis.md`](10-context7-architectural-analysis.md) — the pattern we're copying
3. [`11-manifest-translator-algorithm.md`](11-manifest-translator-algorithm.md) — the hardest component
4. [`04-mcp-tool-design.md`](04-mcp-tool-design.md) — how the 3 tools are shaped
5. [`02-claude-plugin-format.md`](02-claude-plugin-format.md) + [`03-codex-plugin-format.md`](03-codex-plugin-format.md) — what we're translating between
6. Infrastructure trilogy: [`05-cloudflare-workers-playbook.md`](05-cloudflare-workers-playbook.md), [`06-d1-schema-design.md`](06-d1-schema-design.md), [`08-github-indexer-design.md`](08-github-indexer-design.md)
7. Quality + verification: [`09-quality-scoring-rubric.md`](09-quality-scoring-rubric.md), [`12-verification-playbook.md`](12-verification-playbook.md)

## Non-goals (v0.1)

- Web dashboard
- Skill signing / Sigstore provenance
- Private/auth-gated skills
- Third-party marketplace federation
- 100%-lossless translation (some fields are explicitly lossy; see [`11-manifest-translator-algorithm.md`](11-manifest-translator-algorithm.md))

## Success criteria (excerpt; full matrix in `12-verification-playbook.md`)

1. `curl https://registry.marketplace.blazesportsintel.com/.claude-plugin/marketplace.json | jq '.plugins | length'` ≥ 10
2. `curl https://registry.marketplace.blazesportsintel.com/.agents/plugins/marketplace.json | jq '.plugins | length'` ≥ 10
3. `curl https://api.marketplace.blazesportsintel.com/health` returns `{"status":"ok",...}`
4. `npx @blazesportsintel/universal-skills-mcp` prints "Server running on stdio"
5. In a fresh Claude Code session with the server registered: `resolve-skill("pdf")` returns ≥3 results spanning both ecosystems
6. Same query from a fresh Codex session returns parallel results
7. Translator round-trip `claude→codex→claude` preserves every semantic field via `codex_ecosystem.json` sidecar (lossy fields logged, not silently dropped)
