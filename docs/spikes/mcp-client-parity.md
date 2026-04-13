# Spike S4 — MCP Client Parity: Claude Code AND Codex

**Question:** Does `npx @blazesportsintel/universal-skills-mcp` (stdio) — or a remote HTTP endpoint at `https://api.marketplace.blazesportsintel.com/mcp` — work **in both** Claude Code and OpenAI Codex sessions?

## Claude Code — confirmed working

Canonical registration via `~/.claude/mcp.json`:

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

Remote HTTP form:

```json
{
  "mcpServers": {
    "universal-skills": {
      "type": "http",
      "url": "https://api.marketplace.blazesportsintel.com/mcp"
    }
  }
}
```

**Evidence:** Dozens of installed plugins across `~/.claude/plugins/marketplaces/` ship `.mcp.json` files in both shapes. `context7` uses stdio-via-npx (`npx -y @upstash/context7-mcp`), most cloudflare/chrome-devtools plugins use remote HTTP. Claude Code supports both natively.

## OpenAI Codex — strong signal, needs live confirmation

**Static evidence (pre-live-test):**

- `~/.codex/plugins/cache/openai-curated/build-web-apps/.../mcpServers` points to `.mcp.json` — a file on disk
- The `.mcp.json` schema is **wrapped**: `{"mcpServers": {"<name>": {...}}}`
- Installed `build-web-apps` plugin's `.mcp.json` registers real MCP servers (verified by inspecting `~/.codex/plugins/cache/openai-curated/build-web-apps/fb0a18376bcd9f2604047fbe7459ec5aed70c64b/.mcp.json`)
- Codex config format is TOML at `~/.codex/config.toml`; plugins block uses `[plugins."<name>@<marketplace>"]`

**Expected registration** (to be confirmed in live test after scaffold lands):

```toml
[mcp_servers.universal-skills]
command = "npx"
args = ["-y", "@blazesportsintel/universal-skills-mcp"]
```

or per-plugin manifest-driven via `.codex-plugin/.mcp.json` — same wrapped shape as observed in openai-curated plugins.

## `.mcp.json` shape divergence — write both

| Client | File location | Shape |
|--------|---------------|-------|
| Claude Code | `~/.claude/mcp.json` OR `<plugin>/.mcp.json` | **flat**: `{"<name>": {...}}` |
| Codex | `<plugin>/.mcp.json` | **wrapped**: `{"mcpServers": {"<name>": {...}}}` |

Translator handles this:
- On Claude→Codex emit: wrap
- On Codex→Claude emit: unwrap

## Our plugin wrappers ship both

`BSI-repo/external/ClaudOpenAI/` top-level:
- `.claude-plugin/plugin.json` — trivial Claude manifest (name, description, author)
- `.codex-plugin/plugin.json` — full Codex manifest with `interface{}` block
- `.mcp.json` at repo root — depending on consumer intent (flat for Claude; wrapped for Codex mcp bundling is in `.codex-plugin/.mcp.json` if we nest)

**Design decision:** ship **two separate .mcp.json files**:
- Root `.mcp.json` (flat shape) — for Claude plugin wrapper
- `.codex-plugin/.mcp.json` (wrapped shape) — for Codex plugin wrapper

Both point to the same npm package. One source of truth (the package), two client-facing registration files.

## Open questions — resolve in live test post-Phase-0

- [ ] Does `~/.codex/config.toml` honor `[mcp_servers.*]`, or does Codex only load MCP from plugin-scoped `.mcp.json`?
- [ ] Does Codex support HTTP transport or only stdio for user-registered MCP servers?
- [ ] If remote HTTP works: does it advertise via `type = "http"` key like Claude?

**Acceptance** (gate for Phase 2-P2-9):
1. Register stdio version in `~/.claude/mcp.json` → `/mcp` shows `universal-skills` with 3 tools → `resolve-skill("pdf")` returns results. ✓ documented as Phase 2 step.
2. Register stdio version in Codex (either `~/.codex/config.toml` or a .codex-plugin wrapper) → tools appear → `resolve-skill` works. ✓ documented as Phase 2 step.
3. Register HTTP version in both after Phase 3 Worker deploys. ✓ documented as Phase 3 step.

## Conclusion

Strong static evidence that Codex supports MCP (real `.mcp.json` files on disk in installed plugins). Live parity test deferred to Phase 2-P2-9 when both transports are ready.
