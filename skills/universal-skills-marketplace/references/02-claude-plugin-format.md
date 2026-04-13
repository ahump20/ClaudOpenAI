# 02 — Claude Plugin Format

Reverse-engineered from 35+ real plugins under `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/` and `external_plugins/`. The authoritative reference is Anthropic's own [`plugin-dev/skills/plugin-structure`](file:///Users/AustinHumphrey/.claude/plugins/marketplaces/claude-plugins-official/plugins/plugin-dev/skills/plugin-structure/) — this doc summarizes the observed shape for the translator's purposes.

## Core insight: Claude plugins are convention-based

Unlike Codex, which packs everything into `plugin.json`, Claude plugins rely on **directory conventions**. The manifest carries only identity metadata:

```json
{
  "name": "context7",
  "description": "...",
  "author": { "name": "Upstash" }
}
```

That's the whole `.claude-plugin/plugin.json` for context7 (7 lines, verbatim from `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/context7/.claude-plugin/plugin.json`).

Everything else is discovered by walking directories.

## The directory conventions

A full Claude plugin looks like:

```
<plugin-name>/
├── .claude-plugin/
│   ├── plugin.json          # minimal manifest (name, description, author)
│   └── codex_ecosystem.json # (optional; ClaudOpenAI sidecar for preserving Codex-only fields)
├── .mcp.json                # MCP server declaration (FLAT shape)
├── hooks/
│   └── hooks.json           # event → matcher → command bindings
├── skills/
│   └── <skill-name>/
│       ├── SKILL.md         # YAML frontmatter + body
│       ├── references/      # progressive disclosure deep content
│       ├── scripts/         # executable or source scripts
│       └── assets/          # templates, fixtures, binaries
├── agents/
│   └── <agent-name>.md      # subagent definition (frontmatter: name, description, tools, model, color)
├── commands/
│   └── <command-name>.md    # slash-command definition (frontmatter: description, argument-hint, allowed-tools)
└── LICENSE                  # plain-text license file
```

Nothing in `plugin.json` points to these — Claude's plugin loader walks them.

## `.claude-plugin/plugin.json` schema (observed)

### Required

- `name` — string, kebab-case slug matching the directory name
- `description` — string, one-sentence summary

### Common

- `author` — `{name, email?, url?}`

### Observed in some plugins (extension fields)

None beyond those three. Anthropic's `plugin-dev` skill may document additional optional fields but they aren't observed in the 35+ plugins sampled.

Therefore, the **minimal viable Claude `plugin.json`**:

```json
{
  "name": "my-plugin",
  "description": "What it does in one sentence."
}
```

Plus `.mcp.json` (if MCP integration) and whatever convention dirs.

## `.mcp.json` schema — FLAT shape

```json
{
  "<server-name-1>": {
    "type": "http",
    "url": "https://...:mcp"
  },
  "<server-name-2>": {
    "command": "npx",
    "args": ["-y", "some-npm-package"]
  }
}
```

Two transports observed:
- **Remote HTTP**: `{ "type": "http", "url": "..." }`
- **Local stdio**: `{ "command": "...", "args": [...], "env": {...}? }`

Each server can have `"env"` for environment-variable plumbing.

## `hooks/hooks.json` schema

```json
{
  "description": "Optional plugin-level description",
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/scripts/pre-bash.sh", "timeout": 5000 }
        ]
      }
    ],
    "PostToolUse": [...],
    "Stop": [...],
    "SessionStart": [...],
    "UserPromptSubmit": [...]
  }
}
```

Events observed: `PreToolUse`, `PostToolUse`, `Stop`, `SessionStart`, `UserPromptSubmit`. Tool matchers are strings (exact tool name) or regex.

`${CLAUDE_PLUGIN_ROOT}` is the installed-plugin root at runtime.

## `skills/<skill>/SKILL.md` frontmatter keys (union, observed)

| Key | Type | Required | Notes |
|-----|------|----------|-------|
| `name` | string | yes | kebab-case; must match `<skill>` dir |
| `description` | string | yes | one-sentence trigger explainer |
| `version` | string | no | semver |
| `allowed-tools` | string (CSV) OR array | no | narrows runtime tool permissions |
| `disable-model-invocation` | boolean | no | `true` = skill only invokable via slash command, not auto-detected by LLM |
| `user-invocable` | boolean | no | `true` = appears in slash-menu |
| `color` | string | no | hex color for UI accent |
| `model` | string | no | override default model for this skill |
| `tools` | array<string> | no | (on agent.md frontmatter, not SKILL.md typically) |

## `agents/<agent>.md` frontmatter

```yaml
---
name: my-agent
description: When to invoke this agent
tools: [Read, Edit, Bash]
model: claude-sonnet-4-5
color: "#BF5700"
---

# My Agent

Body defines agent instructions.
```

## `commands/<command>.md` frontmatter

```yaml
---
description: What the command does
argument-hint: <file-path>
allowed-tools: [Read, Edit]
---

Command body / prompt template.
```

## Marketplace catalog: `.claude-plugin/marketplace.json`

Ships at the marketplace-repo root (e.g. `anthropics/claude-plugins-official/.claude-plugin/marketplace.json`). Lists plugins the marketplace hosts.

Observed shape (from anthropics/claude-plugins-official):

```json
{
  "name": "claude-plugins-official",
  "description": "Official Anthropic Claude Code plugins",
  "owner": { "name": "Anthropic", "url": "https://anthropic.com" },
  "plugins": [
    {
      "name": "mcp-server-dev",
      "source": "./plugins/mcp-server-dev",
      "description": "Build MCP servers"
    },
    {
      "name": "context7",
      "source": {
        "source": "git-subdir",
        "url": "https://github.com/upstash/context7",
        "subdir": ".",
        "ref": "main"
      }
    }
  ]
}
```

Each plugin entry has:
- `name` — plugin slug
- `description` — summary
- `source` — either a local path (string) OR an object with `source: "git-subdir"` + `url` + `subdir` + `ref`

## Real examples in our `assets/real-examples/`

- `context7-plugin.json` — the 7-line minimal baseline (we emulate this for `.claude-plugin/plugin.json`)
- `mcp-server-dev-plugin.json` — Anthropic's own MCP server development plugin (shows the real baseline from first-party)
- `hookify-plugin.json` + `hookify-hooks.json` — shows the hooks convention with real matchers

Annotations on each file indicate the absolute source path in the local filesystem, so the reader can verify.

## What Claude's plugin loader actually reads

At runtime, Claude Code:
1. Reads `plugin.json` for identity
2. Walks `skills/` — each subdir with a SKILL.md becomes a registered skill; trigger keywords come from frontmatter `description`
3. Walks `agents/` — each `.md` file becomes a subagent; frontmatter `description` determines auto-invocation
4. Walks `commands/` — each `.md` becomes a slash command
5. Reads `hooks/hooks.json` — registers event handlers
6. Reads `.mcp.json` — registers MCP servers

No `plugin.json` field drives any of this. Purely convention.

## Translator implications

Claude→Codex must **synthesize** the Codex manifest's richer structure from walked dirs. Codex→Claude must **strip to minimal** plugin.json and stash the rest in sidecar (`codex_ecosystem.json`).

Implementation: `packages/mcp-server/src/lib/translator.ts` functions `toCanonical(claude_dir)` walks all conventions; `fromCanonical(c, "claude")` writes only the 3-field `plugin.json` plus all the walked dirs plus the sidecar.

See [`11-manifest-translator-algorithm.md`](11-manifest-translator-algorithm.md) for the full algorithm.

## Gotchas

- **Nested skills directories not observed** — Claude expects `skills/<skill>/SKILL.md`, never `skills/<group>/<skill>/SKILL.md`. Flatten on translation.
- **`.md` vs `.markdown`** — Claude reads `.md` only (observed). Codex same.
- **UTF-8 BOM** — several real plugins ship with BOM prefixes. Parser must strip BOM before YAML parse.
- **Frontmatter YAML vs `frontmatter` package** — use `gray-matter` (handles `---` delimiters, block arrays, etc.). Do not hand-parse.
- **`${CLAUDE_PLUGIN_ROOT}` env substitution** happens at hook execution time. Our translator leaves the string literal in place — it's a runtime concern.

## Source references

- `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/plugin-dev/skills/plugin-structure/SKILL.md`
- `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/plugin-dev/skills/skill-development/SKILL.md`
- `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/mcp-server-dev/.claude-plugin/plugin.json`
- `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/context7/.claude-plugin/plugin.json`
- `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/hookify/hooks/hooks.json`
