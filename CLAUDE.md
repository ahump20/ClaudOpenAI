# CLAUDE.md — ClaudOpenAI (Universal Skills Marketplace)

Scope-local instructions for agents working inside this repo. Inherits BSI's parent `CLAUDE.md` (at `BSI-repo/CLAUDE.md`) for reporting standard, anti-fabrication, and global rules.

> **Identity rule (non-negotiable):** This is an **unofficial, independent, community project**. Never claim or imply endorsement by Anthropic or OpenAI. Never position this as an official product of either company. "ClaudOpenAI" is a portmanteau, not a partnership.

## What this is

A Context7-pattern MCP server that bridges the two largest agent-CLI ecosystems — Claude Code and OpenAI Codex — by indexing skills and plugins from both sides and serving a unified MCP API. The skill format is shared (agentskills.io / SKILL.md); the plugin manifest formats diverge and the translator is the core technical deliverable.

Full rationale in [`../../../../.claude/plans/zesty-growing-flurry.md`](../../../../.claude/plans/zesty-growing-flurry.md) and [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Deliverables

1. **Claude Code plugin wrapper** (`.claude-plugin/plugin.json` — 7 lines, context7-style)
2. **Codex plugin wrapper** (`.codex-plugin/plugin.json` — full `interface{}` block)
3. **Guidance skill** at `skills/universal-skills-marketplace/` — skill-creator router pattern, ≥12 references, templates, scripts
4. **npm package** `packages/mcp-server/` — `@blazesportsintel/universal-skills-mcp`
5. **Schema package** `packages/schema/` — zod + JSON Schema source of truth
6. **Three Cloudflare Workers** under `workers/` — api, indexer, bridge
7. **D1 + R2 + KV** infrastructure via `schema/` + wrangler configs

## Hard rules (inherited from BSI parent + scope-local additions)

### Anti-Fabrication Protocol
- If an upstream URL isn't verified (Spike S1), it does NOT ship in the indexer catalog.
- If a field isn't observed in a real installed plugin, it does NOT appear in the canonical schema.
- "I don't know" is an acceptable answer. Plausible-sounding fiction is not.

### Anti-Mock-Data Protocol
- Never hardcode skill lists, sample plugins, or placeholder catalogs anywhere except under `tests/fixtures/` and `skills/*/assets/fixtures/`.
- The indexer always pulls real data from real repos. The bridge always reads from real D1.
- Any `Math.random()`, `faker.*`, `mockData`, `sampleData` identifiers in non-test source files are forbidden and blocked by the pre-commit hook (when added).

### Verification Protocol
- "Build passed" ≠ acceptance. Acceptance = `curl`ing the live URL returns the expected shape, AND the tool fires in a fresh Claude Code AND Codex session.
- Phase-acceptance criteria are in the plan file. Record evidence to `docs/verification-evidence/`.

### Anti-Freshness-Fabrication
- Every MCP tool result includes `meta: { source, fetched_at, timezone: "America/Chicago" }`.
- Never hardcode "updated recently" or "live" strings. Compute from `meta.fetched_at`.

### Data surface states
- Every data-returning tool handles four states explicitly: loading (not applicable for stdio/HTTP — implicit), **error** (typed error with recovery hint), **empty** ("no skills matching X" with suggestion), **populated** (array of results + meta).
- No `undefined`, no blank output, no generic "failed."

### Reporting standard
- Report user-visible outcomes, not build steps. Good: "The marketplace endpoint now returns 12 skills across both ecosystems." Bad: "Wrangler deployed successfully."

### Contradiction surfacing
- If `CLAUDE.md`, plan file, spike docs, or installed-plugin reality conflict: surface the mismatch. Do not silently pick one.

### context7 fidelity
- The plugin wrapper is trivial (7 lines on Claude side, fuller on Codex side with the `interface{}` block). **Real logic lives in the npm package.** If code grows in the wrapper, it's wrong.

### Translator loudness
- Never silently drop fields. Every lossy conversion writes to `translation_log` with `level: "warning" | "lossy"` and produces a visible shim (HTML comment / notes markdown / ecosystem sidecar / hook fallback).

## Commands

```bash
# One-shot validation (must pass before any commit)
bash skills/universal-skills-marketplace/scripts/validate.sh

# Build + test (Phase 2+)
npm install
npm run typecheck
npm run lint
npm test
npm run build

# Translator round-trip (Phase 2+)
node skills/universal-skills-marketplace/scripts/test-translator.ts --all-fixtures

# Cloudflare dev (Phase 3+)
npm run dev:api         # wrangler dev workers/universal-skills-api
npm run dev:indexer     # wrangler dev --test-scheduled workers/universal-skills-indexer
npm run dev:bridge      # wrangler dev workers/universal-skills-bridge

# Cloudflare deploy (Phase 3+)
npm run deploy:all      # deploy all three workers
```

## Directories

```
.claude-plugin/       # Claude plugin wrapper (trivial)
.codex-plugin/        # Codex plugin wrapper (full interface{} block)
.agents/plugins/      # Static Codex marketplace.json snapshot
skills/universal-skills-marketplace/  # Guidance skill (router pattern)
packages/mcp-server/  # npm package source
packages/schema/      # Shared zod + JSON Schema
workers/{api,indexer,bridge}/  # Three Cloudflare Workers
schema/               # D1 DDL + JSON Schema files
docs/spikes/          # Phase 0 research outputs
docs/verification-evidence/  # E2E test logs
```

## iCloud notes (per `docs/spikes/icloud-build-strategy.md`)

This repo lives in iCloud. Build artifacts must not. `.gitignore` excludes `node_modules/`, `.wrangler/`, `dist/`, `coverage/`. If builds stall, escalate to `scripts/build-safe.sh` staging at `/var/tmp/claudopenai-build/`.

## Session discipline

- Use the plan file as source of truth for task ordering: `~/.claude/plans/zesty-growing-flurry.md`
- One task `in_progress` at a time (per superpowers:executing-plans)
- Announce skill usage when invoking skills
- Run verification commands before marking tasks complete
- Stop and ask rather than guessing

## Non-goals (v0.1)

- Web dashboard
- Skill signing / Sigstore provenance
- Private/auth-gated skills
- Community PR flow for third-party contributions
- Translator that preserves 100% of every ecosystem-specific field (some are explicitly lossy, with shims documented)
