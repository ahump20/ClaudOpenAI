---
name: universal-skills-marketplace
description: Use when building, designing, extending, or consuming the ClaudOpenAI unofficial cross-ecosystem skills marketplace — a Context7-pattern MCP server that bridges Claude Code (.claude-plugin) and OpenAI Codex (.codex-plugin) skill catalogs. Triggers on "universal skills", "skills marketplace", "cross-ecosystem skill", "agentskills", "codex skill", "claude plugin", "plugin.json translator", "skill registry", "skill discovery", "publish skill to both claude and codex", "ClaudOpenAI", "bridge claude and codex".
version: 0.1.0
---

# Universal Skills Marketplace

Context7 for skills, not docs. One MCP server. Two ecosystems. Unofficial.

## Mission

Build, maintain, or extend an unofficial bridge that lets **any Claude Code or OpenAI Codex session** search one registry for skills originating in either ecosystem, get them back with quality scores + install commands for both CLIs, and load them on demand.

Not affiliated with Anthropic or OpenAI. Identity details in [`references/00-architecture-overview.md`](references/00-architecture-overview.md#identity-positioning).

## Routing table — pick the right reference

| I want to… | Primary reference | Supporting asset / script |
|------------|-------------------|---------------------------|
| Understand the whole system | `references/00-architecture-overview.md` | `assets/diagrams/system-topology.png` |
| Learn the SKILL.md open standard | `references/01-agentskills-io-spec-walkthrough.md` | `assets/templates/standalone-SKILL.md.template` |
| Author a Claude plugin | `references/02-claude-plugin-format.md` | `assets/templates/claude-plugin.json.template`, `assets/real-examples/context7-plugin.json` |
| Author a Codex plugin | `references/03-codex-plugin-format.md` | `assets/templates/codex-plugin.json.template`, `assets/real-examples/openai-canva-plugin.json` |
| Design MCP tools | `references/04-mcp-tool-design.md` | `assets/templates/mcp-server-index.ts.template` |
| Deploy Cloudflare Workers | `references/05-cloudflare-workers-playbook.md` | `assets/templates/wrangler.toml.*.template` |
| Design the D1 catalog | `references/06-d1-schema-design.md` | `assets/templates/d1-schema.sql.template` |
| Plan R2 content storage | `references/07-r2-storage-patterns.md` | — |
| Build the upstream indexer | `references/08-github-indexer-design.md` | `scripts/fetch-upstream-catalog.sh` |
| Score skill quality 0-100 | `references/09-quality-scoring-rubric.md` | `assets/fixtures/known-good/` |
| Copy what Context7 got right | `references/10-context7-architectural-analysis.md` | `assets/real-examples/context7-*.json` |
| Translate between manifest formats | `references/11-manifest-translator-algorithm.md` | `scripts/test-translator.ts`, `assets/fixtures/lossy-cases/` |
| Verify end-to-end | `references/12-verification-playbook.md` | `scripts/validate.sh` |

## Phase dispatcher

- **Planning / just arrived** → read `00-architecture-overview.md`, then `10-context7-architectural-analysis.md`, then `references/11-manifest-translator-algorithm.md` (the three anchoring docs)
- **Phase 0 — spikes complete** → evidence in `/docs/spikes/` (upstream URLs verified, Codex schema derived, rate limits mapped, iCloud strategy documented)
- **Phase 1 — schemas + this skill** → you are here; running this skill IS Phase 1's deliverable
- **Phase 2 — npm package** → `packages/mcp-server/` implementation driven by `04-mcp-tool-design.md` + `11-manifest-translator-algorithm.md`
- **Phase 3 — Cloudflare backend** → three Workers driven by `05-cloudflare-workers-playbook.md` + `06-d1-schema-design.md` + `08-github-indexer-design.md`

## Hard rules (inherited from `../../CLAUDE.md`)

1. **Anti-Fabrication** — if a URL, field, or behavior isn't verified against installed plugins or a live upstream, it does NOT ship.
2. **Anti-Mock-Data** — no hardcoded skills anywhere except `assets/fixtures/` and `packages/*/tests/fixtures/`.
3. **Verification** — "build passed" ≠ acceptance; `curl` + fresh Claude Code AND Codex session required.
4. **Translator loudness** — no silent field drops; every lossy translation logs + shims.
5. **context7 fidelity** — plugin wrapper stays trivial; all logic in the npm package.
6. **Identity** — unofficial, independent, community project. Never imply endorsement from either company.

## Run before any commit

```bash
bash skills/universal-skills-marketplace/scripts/validate.sh
```

Must exit 0. Checks: frontmatter valid, SKILL.md ≤100 lines, all 12 references present, all templates parse, no broken intra-skill links.
