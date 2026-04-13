# ClaudOpenAI — Universal Skills Marketplace

> **Unofficial. Independent. Community project.** Not affiliated with, endorsed
> by, or sponsored by Anthropic or OpenAI. See [NOTICE](./NOTICE).

Context7 for skills, not docs. A single MCP server that any Claude Code or
OpenAI Codex session can connect to and ask: *"find me a skill for X"* → get
back the best match across both ecosystems → load it on demand.

---

## Why this exists

Claude Code and OpenAI Codex have converged on the same
[agentskills.io](https://agentskills.io) open standard for **skills**
(`SKILL.md` with YAML frontmatter + `references/` / `scripts/` / `assets/`) but
diverge on their **plugin manifests** (`.claude-plugin/plugin.json` vs
`.codex-plugin/plugin.json`) and **marketplace catalogs**.

Today a skill author has to publish twice and a skill consumer can't search
one registry across both. ClaudOpenAI is the missing bridge.

---

## What it does

1. **Indexes** skills and plugins from public upstream repos in both ecosystems
   — including `anthropics/claude-plugins-official`, `anthropics/skills`,
   `anthropics/knowledge-work-plugins`, `openai/codex`, `openai/skills`,
   `openai/swarm`, `openai/openai-agents-python`, and `openai/codex-plugin-cc`.
2. **Normalizes** both manifest formats into one canonical intermediate
   representation (zod schema + JSON Schema).
3. **Exposes** three MCP tools via `stdio`, streamable-HTTP, and SSE:
   - `resolve-skill(query, filters)` — BM25 + semantic search
   - `get-skill-content(id)` — progressive-disclosure fetch (metadata → body → references)
   - `install-skill(id, target)` — writes to `~/.claude/skills/` or `~/.codex/skills/`
4. **Serves** both ecosystems' `marketplace.json` formats dynamically from the
   same backend:
   - `GET /.claude-plugin/marketplace.json` (Claude format)
   - `GET /.agents/plugins/marketplace.json` (Codex format)

---

## Architecture (at a glance)

```
upstream repos → indexer (cron 6h) → D1 catalog + R2 content cache
                                              ↓
                          ┌───────────────────┴────────────────────┐
                          ↓                                        ↓
             HTTP MCP API Worker                       marketplace.json bridge
             (api.marketplace.blazesportsintel.com)    (registry.marketplace.blazesportsintel.com)
                          ↓                                        ↓
           Claude Code / Codex CLI                     /plugin marketplace add …
           (npx @blazesportsintel/universal-skills-mcp)
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the deep design (D1 ERD, R2 key
structure, translator algorithm, indexer state machine).

---

## Install

### Claude Code

```bash
/plugin marketplace add ahump20/ClaudOpenAI
/plugin install universal-skills-marketplace@ClaudOpenAI
```

Or manually add to `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "universal-skills": {
      "command": "npx",
      "args": ["-y", "@blazesportsintel/universal-skills-mcp"]
    }
  }
}
```

### OpenAI Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.universal-skills]
command = "npx"
args = ["-y", "@blazesportsintel/universal-skills-mcp"]
```

### Remote (no install)

Point any MCP-compatible client at:

```
https://api.marketplace.blazesportsintel.com/mcp
```

---

## Repository layout

```
.claude-plugin/plugin.json         # Claude wrapper (trivial, context7-style)
.codex-plugin/plugin.json          # Codex wrapper with full interface{} block
.mcp.json                          # Top-level MCP server declaration
skills/universal-skills-marketplace/   # The guidance skill (router pattern)
packages/mcp-server/               # @blazesportsintel/universal-skills-mcp (npm)
packages/schema/                   # @blazesportsintel/universal-skills-schema (npm)
workers/universal-skills-api/      # HTTP MCP transport (Cloudflare Worker)
workers/universal-skills-indexer/  # Cron-driven upstream indexer
workers/universal-skills-bridge/   # Dynamic marketplace.json emitter
schema/                            # D1 DDL + JSON Schema files
docs/                              # quickstart, authors-guide, spike outputs
```

---

## Status

**v0.1.0 (in development).** Phased build per
[`~/.claude/plans/zesty-growing-flurry.md`](../../../../.claude/plans/zesty-growing-flurry.md):

- [ ] Phase 0: Spikes (upstream URL validation, Codex schema diff, rate limits, MCP parity)
- [ ] Phase 1: Schemas + guidance skill package
- [ ] Phase 2: npm MCP server (local demo in Claude Code + Codex)
- [ ] Phase 3: Cloudflare Workers backend (D1 + R2 + indexer + bridge)
- [ ] Phase 4: Release (npm publish + marketplace submission)

Not ready for production. Not claiming official endorsement from either
Anthropic or OpenAI. "Born to Blaze the Path Beaten Less."

---

## License

[Apache 2.0](./LICENSE) — matches the agentskills.io open standard.

## Author

Austin Humphrey ([@a_hump20](https://x.com/a_hump20)) · [Blaze Sports Intel](https://blazesportsintel.com)
