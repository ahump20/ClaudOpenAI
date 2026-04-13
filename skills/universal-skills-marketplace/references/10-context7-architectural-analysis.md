# 10 — Context7 Architectural Analysis

Why we're copying it, what they got right, where we diverge.

Source repo: `github.com/upstash/context7` (52K+ ⭐, per Plan Agent 2's research).
Local plugin: `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/context7/`.
Source of truth files:
- `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/context7/.claude-plugin/plugin.json` (7 lines)
- `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/context7/.mcp.json` (5 lines)

## What context7 does

Indexes library documentation from upstream sources, normalizes it, serves it via MCP. Two tools:

1. `resolve-library-id(query)` — "I want to use Next.js 15 App Router" → returns `/vercel/next.js/v15`
2. `query-docs(libraryId, topic)` — returns focused doc snippets for that library + topic

Works in Claude Code, Cursor, Continue, and ~20 other MCP hosts.

## What we're copying

### 1. Plugin wrapper is trivial

`context7`'s `.claude-plugin/plugin.json` is **literally 7 lines**:

```json
{
  "name": "context7",
  "description": "Upstash Context7 MCP server for up-to-date documentation lookup. Pull version-specific documentation and code examples directly from source repositories into your LLM context.",
  "author": {
    "name": "Upstash"
  }
}
```

The `.mcp.json` is 5 lines:

```json
{
  "context7": {
    "command": "npx",
    "args": ["-y", "@upstash/context7-mcp"]
  }
}
```

**Total plugin payload: 12 lines + a LICENSE.** No skills, no agents, no commands, no hooks. Just metadata pointing to the real implementation (the npm package `@upstash/context7-mcp`).

We replicate this exactly. Our `.claude-plugin/plugin.json` is 5 fields. Our `.mcp.json` is 3 lines. The real work is in `@blazesportsintel/universal-skills-mcp` on npm.

**Why this matters:** the plugin is a distribution shell, not the product. Users can install via `/plugin install` OR bypass the plugin entirely and just put the MCP entry in their own `~/.claude/mcp.json`. Context7 lets users do both. So do we.

### 2. Two-tool Pattern B for large surfaces

Context7's surface: **all** library docs across many libraries. Too large for one-tool-per-library. They split into `resolve` (find the library ID) + `query-docs` (fetch content).

Our surface: **all** skills across two ecosystems. Same shape. We split into `resolve-skill` + `get-skill-content` + `install-skill`.

Per Anthropic's `build-mcp-server/SKILL.md` Phase 3, Pattern B is the explicit recommendation for large surfaces.

### 3. Remote HTTP + stdio fallback

Context7 offers **both**:
- Remote URL: `https://mcp.context7.com/mcp` (HTTP streamable)
- Local via npx: `npx -y @upstash/context7-mcp` (stdio)

One npm package. Two deployment modes. Users pick what fits their setup.

Ours: same model. Remote URL at `api.marketplace.blazesportsintel.com/mcp` via Workers. stdio via `npx -y @blazesportsintel/universal-skills-mcp`.

### 4. "We don't own the data, we just index it"

Context7 doesn't rewrite library docs. It pulls from source repos, caches, serves. Link-to-source is visible in every response.

Our philosophy: **never copy upstream skill content**. We index, we normalize, we cache for retrieval, but every result links to the upstream repo + commit SHA. Users retain the ability to go upstream for truth.

Per constraint line 155 of the source prompt: "Do NOT fork or copy skill content — always link to source repos and fetch on demand."

### 5. Cross-client compatibility via spec compliance

Context7 doesn't ship special Claude-only or Cursor-only code. It implements MCP (the spec) correctly. Every MCP-compliant client can use it without special treatment.

Our approach: ship spec-compliant MCP. Both Claude Code and Codex consume the same server. No forking of behavior per client.

### 6. Transparent caching

Context7's CDN-backed cache layer serves repeat queries without origin hits. Users don't see the caching; they see fast responses.

Ours: Cloudflare Workers' built-in cache + explicit KV cache layer for resolve-skill queries (TTL 10min). R2 gets CDN treatment automatically (`cache-control: immutable`).

## Where we DIVERGE from context7

### 1. Marketplace bridge (we add this)

Context7 is pure MCP — no marketplace.json. Our bridge worker additionally emits both `/.claude-plugin/marketplace.json` and `/.agents/plugins/marketplace.json` so we're discoverable via plugin marketplace commands on both CLIs.

Why: our users want to `/plugin marketplace add ahump20/ClaudOpenAI` and have the whole catalog appear. Context7 doesn't need that (their unit is libraries, not plugins).

### 2. Install action (we add this)

Context7's tools are read-only (`resolve` + `query-docs`). We add `install-skill`, a write action. Keeps defaults safe (`mode=command-only`) but enables direct write-to-disk when explicit.

Why: skills are installable artifacts; library docs aren't. Different shape of user intent.

### 3. Ecosystem translation (we add this)

Context7 serves uniform library docs. No translation needed — a doc is a doc.

We serve skills that originate in one of two ecosystems, and the user might consume them in the OTHER. The translator (see [`11-manifest-translator-algorithm.md`](11-manifest-translator-algorithm.md)) is our ecosystem-bridging core. Context7 doesn't have this problem.

### 4. Open-source + self-hostable (we aim for this)

Context7 is Apache 2.0 and runs on Upstash's infrastructure. Their source is public; anyone can self-host.

We're Apache 2.0 + source on GitHub. The Worker config assumes Austin's Cloudflare account but the Wrangler configs are portable — anyone could deploy to their own account by changing bindings.

### 5. Quality scoring (we add this)

Context7 ranks results by documentation freshness + relevance. Simpler — docs are pretty uniformly high quality when pulled from official sources.

We score 0-100 across multiple axes (structure, description, examples, validation, tests, stars) because skills vary wildly in quality. See [`09-quality-scoring-rubric.md`](09-quality-scoring-rubric.md).

## What context7 got (maybe) wrong that we avoid

### 1. Privacy-first IP encryption

Context7 apparently encrypts client IPs for privacy. Nice in theory; adds complexity.

For v0.1, we don't store IPs past the KV rate-limit window (60s TTL). Simpler. Ship this as a v0.2 enhancement if demand exists.

### 2. Library-centric naming

"Context7" means nothing to someone unfamiliar. The name leaks no semantics.

We picked "ClaudOpenAI" — portmanteau of the two ecosystems it bridges. Clearer intent. (Austin's verbatim choice.)

### 3. Unclear installability via plugin manifest

context7's plugin has no skills, no commands — users literally install via `/plugin install context7@claude-plugins-official` but the only thing that gets installed is the MCP server entry. Feels like the plugin system is being bent to its purpose.

We ship a **real guidance skill** (`skills/universal-skills-marketplace/`) inside the plugin. So when someone `/plugin install`s us, they get both the MCP server AND a skill that teaches them how the system works + how to extend it. Adds value to the plugin wrapper instead of making it vestigial.

## Files to study locally

- `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/context7/.claude-plugin/plugin.json` — the 7-line wrapper
- `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/context7/.mcp.json` — the 5-line server declaration
- `~/.claude/plugins/cache/claude-plugins-official/context7/unknown/.claude-plugin/plugin.json` — cached clone of same

If the upstream `@upstash/context7-mcp` npm package source is accessible (via `npm view @upstash/context7-mcp repository`), pull it and study the MCP handler shape. Structure should parallel our `packages/mcp-server/src/server.ts`.

## Actionable lessons for our implementation

1. **Keep `.claude-plugin/plugin.json` under 10 lines.** If we feel tempted to add fields, remember context7 has 3.
2. **Ship the npm package with a useful `bin`** so `npx -y @blazesportsintel/universal-skills-mcp` works without additional config.
3. **Offer remote HTTP as primary, stdio as fallback** — same pattern as context7.
4. **Link to source in every response** — `source_url`, `source_repo`, `source_commit` in every canonical skill.
5. **Keep tool count small.** Context7 has 2, we have 3. Never grow past 5.
6. **Cache aggressively at the CDN layer.** Workers + Cloudflare cache + R2 immutable = fast out-of-the-box.

## See also

- Source prompt line 15: "Context7 ... is the architectural reference for how a resolution + retrieval MCP works"
- [`04-mcp-tool-design.md`](04-mcp-tool-design.md) — our Pattern B implementation
- [`00-architecture-overview.md`](00-architecture-overview.md) — full topology
- `assets/real-examples/context7-plugin.json` — verbatim copy of context7's wrapper for reference
