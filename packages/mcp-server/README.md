# @blazesportsintel/universal-skills-mcp

Context7-pattern MCP server for the [ClaudOpenAI Universal Skills Marketplace](https://github.com/ahump20/ClaudOpenAI). Indexes skills across both Claude Code and OpenAI Codex ecosystems; exposes three tools via MCP.

> **Unofficial.** Not affiliated with Anthropic or OpenAI. See [NOTICE](../../NOTICE).

## Install

### Claude Code

Add to `~/.claude/mcp.json`:

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

Point any MCP client at `https://api.marketplace.blazesportsintel.com/mcp` (Phase 3 deployment; check status in the [main repo README](../../README.md)).

## Tools

| Tool | Purpose |
|------|---------|
| `resolve-skill` | BM25+quality search; returns ranked skills with install commands for both ecosystems |
| `get-skill-content` | Progressive-disclosure fetch (metadata → body → references → scripts → assets) |
| `install-skill` | Emit install command (default, safe) or write skill directly to `~/.claude/skills/` / `~/.codex/skills/` |

## Usage examples

```
You: "Find me a skill for PDF processing"
→ resolve-skill({ query: "pdf processing" })
← 7 results including anthropics/skills:pdf (score 82)

You: "Install the first one"
→ install-skill({ id: "anthropics-skills/pdf", mode: "command-only" })
← { command: "/plugin install pdf@anthropics-skills", target_dir: "~/.claude/plugins/" }
```

## Configuration

- `GITHUB_TOKEN` — optional; raises GitHub API limit 60rph → 5000rph. Strongly recommended.
- `UNIVERSAL_SKILLS_REGISTRY` — override HttpRegistry backend URL (default: built-in GitHubRegistry for Phase 2 standalone use).
- `--transport stdio|http` — transport mode (default: stdio)
- `--port N` — HTTP port (default: 3007)

## License

Apache 2.0. See [LICENSE](../../LICENSE).
