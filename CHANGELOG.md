# Changelog

All notable changes to ClaudOpenAI. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added
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
