# Changelog

All notable changes to ClaudOpenAI. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added — Phase 2 + Phase 3 code (npm package + Cloudflare Workers)
- `packages/mcp-server/` — `@blazesportsintel/universal-skills-mcp`:
  - `src/index.ts` CLI entry with `--transport stdio|http` flag parsing
  - `src/errors.ts` — 11 typed error classes with HTTP status mapping
  - `src/lib/frontmatter.ts` — gray-matter wrapper + trigger-keyword extractor
  - `src/lib/cache.ts` — LRU memory cache + canonical-JSON-keyed cache keys
  - `src/lib/github-client.ts` — ETag-aware, rate-limit tracking, exponential backoff
  - `src/lib/scorer.ts` — 0-100 deterministic quality score (7 rules)
  - `src/lib/translator.ts` — Claude ↔ Canonical ↔ Codex ↔ Standalone with sidecar/shim generation
  - `src/lib/registry.ts` — dual-backend (GitHubRegistry for Phase 2, HttpRegistry for Phase 3)
  - `src/tools/{resolve-skill,get-skill-content,install-skill}.ts` — zod-validated tool handlers
  - `src/server.ts` — SDK Server factory wiring all 3 tools
  - `src/transports/{stdio,http}.ts`
  - `tests/unit/{scorer,frontmatter,translator}.test.ts` — round-trip + PDF≥70 invariant + lossy-sidecar assertions
- `workers/universal-skills-api/` — HTTP MCP Worker with JSON-RPC 2.0 handler, D1+R2+KV bindings, 60 rpm/IP KV rate limiter, health check
- `workers/universal-skills-indexer/` — cron `0 */6 * * *` indexer; `sources.ts` declares all 9 upstream repos with A/B/C tier assignments; normalize + UPSERT + R2 stream
- `workers/universal-skills-bridge/` — serves `/.claude-plugin/marketplace.json`, `/.agents/plugins/marketplace.json`, `/.well-known/universal-skills.json`, plus a Heritage-styled HTML landing at `/`
- `.github/workflows/ci.yml` — validates skill, typechecks, builds, runs unit tests, verifies D1 schema applies cleanly, verifies all 7 spike docs present
- `.github/workflows/publish-npm.yml` — publishes both npm packages on `v*` tag (needs `NPM_TOKEN` secret)
- `.github/workflows/deploy-workers.yml` — deploys all three Workers on `v*` tag (needs `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` secrets)
- Updated README status checklist with concrete deploy/publish commands for Austin

### Added — Phase 1 (previous commit)
- Repository scaffold with monorepo structure (npm workspaces)
- `.claude-plugin/plugin.json` — trivial Claude Code wrapper (context7-style)
- `.codex-plugin/plugin.json` — Codex wrapper with full `interface{}` block
- `.mcp.json` (flat, Claude shape) — points to `@blazesportsintel/universal-skills-mcp` npm package
- `.codex-plugin/.mcp.json` (wrapped, Codex shape) — same target
- 7 spike documents (`docs/spikes/`):
  - `upstream-availability.md` — all 9 upstream repos verified (anthropics/claude-plugins-official 16.7K⭐, anthropics/skills 115.8K⭐, anthropics/knowledge-work-plugins 11.1K⭐, openai/codex 74.8K⭐, openai/codex-plugin-cc 13.8K⭐ bridge prior art, openai/skills 16.7K⭐, openai/swarm 21.3K⭐ dormant, openai/openai-agents-python 20.7K⭐, openai/plugins 778⭐ host of openai-curated)
  - `codex-schema-drift.md` — union schema derived from 16 installed openai-curated plugins
  - `github-rate-limits.md` — clone-and-walk strategy; authenticated PAT required
  - `mcp-client-parity.md` — both ecosystems support MCP; shapes diverge
  - `dns-setup.md` — Cloudflare subdomain configuration guide
  - `agentskills-provenance.md` — URL-check planned, fallback to observational spec
  - `icloud-build-strategy.md` — `/var/tmp/` staging pattern
- `schema/codex-plugin.schema.json` — formal JSON Schema from Spike S2

### Security
- `.gitignore` excludes `node_modules/`, `.wrangler/`, `dist/`, `.env*`, secrets, iCloud artifacts
- `NOTICE` file clarifies unofficial project status; no implied endorsement from Anthropic or OpenAI

## [0.1.0] — planned

First functional release.

- npm package `@blazesportsintel/universal-skills-mcp` published
- Three Cloudflare Workers deployed to `marketplace.blazesportsintel.com` subdomains
- Indexer cron running every 6h against all 9 upstream repos
- Guidance skill `universal-skills-marketplace` packaged as `.skill`
- Manifest translator handles round-trip with documented lossy fields
