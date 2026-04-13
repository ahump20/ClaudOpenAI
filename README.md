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

**v0.1.0-alpha.0 — all code phases complete, awaiting first deploy.**

- [x] **Phase 0: Spikes** — 7 spike docs in [`docs/spikes/`](./docs/spikes/); all 9 upstream URLs verified
- [x] **Phase 1: Schemas + guidance skill** — [skill package](./skills/universal-skills-marketplace/) (SKILL.md router + 13 deep references + 10 templates + real examples + 7 scripts); zod + JSON Schemas in [`packages/schema/`](./packages/schema/) and [`schema/`](./schema/); D1 DDL with FTS5; `validate.sh` passes 9/9
- [x] **Phase 2: npm MCP server** — [`packages/mcp-server/`](./packages/mcp-server/) with translator, scorer, registry, 3 tools, stdio + http transports, unit tests (scorer/frontmatter/translator round-trip)
- [x] **Phase 3: Cloudflare Workers** — [`workers/universal-skills-api/`](./workers/universal-skills-api/), [`workers/universal-skills-indexer/`](./workers/universal-skills-indexer/), [`workers/universal-skills-bridge/`](./workers/universal-skills-bridge/) with wrangler.toml configs, D1/R2/KV bindings, cron indexer
- [x] **Phase 4: CI** — [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) runs on every PR; `publish-npm.yml` and `deploy-workers.yml` fire on version tags
- [ ] **First deploy** — awaiting `wrangler d1 create universal-skills`, `wrangler r2 bucket create universal-skills-content`, KV namespace creation, DNS setup per [`docs/spikes/dns-setup.md`](./docs/spikes/dns-setup.md)
- [ ] **First npm publish** — awaiting `npm ci && npm run build && npm publish --tag alpha` (requires `NPM_TOKEN` repo secret)

Not ready for production use until the first deploy lands. Not claiming official endorsement from either Anthropic or OpenAI. "Born to Blaze the Path Beaten Less."

## Next steps for Austin

```bash
# 1. Install workspace dependencies
cd external/ClaudOpenAI
npm install

# 2. Verify everything builds and tests pass locally
npm run typecheck --workspaces --if-present
npm test --workspaces --if-present
bash skills/universal-skills-marketplace/scripts/validate.sh

# 3. Provision Cloudflare resources (one-time)
wrangler d1 create universal-skills
wrangler d1 execute universal-skills --file=schema/d1-schema.sql --remote
wrangler r2 bucket create universal-skills-content
wrangler kv:namespace create CACHE
wrangler kv:namespace create RATE_LIMIT
wrangler kv:namespace create INDEXER_STATE
# → paste the returned IDs into each workers/*/wrangler.toml

# 4. Set indexer secret
wrangler secret put GITHUB_TOKEN --config workers/universal-skills-indexer/wrangler.toml

# 5. Deploy all three Workers
cd workers/universal-skills-api && wrangler deploy && cd ../..
cd workers/universal-skills-indexer && wrangler deploy && cd ../..
cd workers/universal-skills-bridge && wrangler deploy && cd ../..

# 6. Trigger initial indexer run (populates D1 from the 9 upstream repos)
curl -X POST https://indexer.marketplace.blazesportsintel.com/run

# 7. Verify the live marketplace
curl https://marketplace.blazesportsintel.com/.claude-plugin/marketplace.json | jq '.plugins | length'
curl https://api.marketplace.blazesportsintel.com/health

# 8. Publish the npm package (after adding NPM_TOKEN to GitHub secrets, then tag v0.1.0-alpha.1)
git tag v0.1.0-alpha.1 && git push origin v0.1.0-alpha.1
```

---

## License

[Apache 2.0](./LICENSE) — matches the agentskills.io open standard.

## Author

Austin Humphrey ([@a_hump20](https://x.com/a_hump20)) · [Blaze Sports Intel](https://blazesportsintel.com)
