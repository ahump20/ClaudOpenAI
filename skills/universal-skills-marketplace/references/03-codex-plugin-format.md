# 03 — Codex Plugin Format

Derived from 16 installed `openai-curated` plugins at `~/.codex/plugins/cache/openai-curated/*/fb0a18376bcd9f2604047fbe7459ec5aed70c64b/.codex-plugin/plugin.json`. Full evidence + field frequencies in [`docs/spikes/codex-schema-drift.md`](../../../docs/spikes/codex-schema-drift.md). JSON Schema at [`schema/codex-plugin.schema.json`](../../../schema/codex-plugin.schema.json).

## Core insight: Codex plugins pack everything into plugin.json

Unlike Claude's minimalist convention-based model, Codex's `plugin.json` is a **rich declarative document**:

- Top-level metadata: name, version, description, author, homepage, repository, license, keywords
- Convention pointers: `skills`, `mcpServers`, `hooks`, `apps` (paths to files/dirs)
- A full `interface{}` block for the Codex marketplace UI (displayName, category, capabilities, icons, colors, etc.)

The reason: Codex's plugin loader is declarative. It reads the manifest to know what the plugin contains.

## Required top-level fields (100% frequency)

| Field | Type | Example |
|-------|------|---------|
| `name` | string (kebab-case) | `"canva"`, `"build-web-apps"` |
| `version` | string (semver) | `"0.1.0"`, `"1.0.0"`, `"2.0.7"` |
| `description` | string | one-sentence summary |
| `author` | object | `{name?, email?, url?}` — shape varies |
| `homepage` | string (URI) | `"https://openai.com/"` |
| `repository` | string (URI) | `"https://github.com/openai/plugins"` |
| `license` | string | `"MIT"`, `"Apache-2.0"`, `"Proprietary"`, `"LicenseRef-Figma-Developer-Terms"` |
| `keywords` | array<string> | 0-17 entries |
| `skills` | string (path) | always `"./skills/"` |
| `interface` | object | see "interface block" below |

## Optional top-level fields (observed frequency)

| Field | Type | Frequency | Example |
|-------|------|-----------|---------|
| `apps` | string (path to `.app.json`) | 56% (9/16) | `"./.app.json"` |
| `mcpServers` | string (path to `.mcp.json`) | 31% (5/16) | `"./.mcp.json"` |
| `hooks` | string (path to `hooks.json`) | 6% (1/16, figma only) | `"./hooks.json"` |

All optional-path fields always point to a file/dir at `./...` relative to the plugin root.

## The `interface{}` block

Codex-only catalog metadata. Used by Codex's marketplace UI to render plugin tiles, category browsing, brand theming.

### 100% required sub-fields

| Field | Type | Purpose |
|-------|------|---------|
| `displayName` | string | Title-case name shown in UI |
| `shortDescription` | string | ≤60 chars, tile tagline |
| `longDescription` | string | Paragraph for detail page |
| `category` | string | Enum observed: `Coding`, `Productivity`, `Communication`, `Research`, `Design` |
| `capabilities` | array<string> | Enum observed: `Interactive`, `Write`, `Read`; can be empty |
| `websiteURL` | string (URI) | Vendor homepage |
| `privacyPolicyURL` | string | Required even if empty (some plugins use `""`) |
| `termsOfServiceURL` | string | Same |
| `defaultPrompt` | string \| array<string> | Suggested prompts. **Shape varies** — canva uses array, most use string. Canonical normalizes to array. |
| `composerIcon` | string | Path to small icon (`./assets/...`) |
| `logo` | string | Path to logo |
| `screenshots` | array | 0-N entries; shape unverified (observed empty in most) |

### 88% required sub-fields

| Field | Type | Present in |
|-------|------|------------|
| `developerName` | string | 14/16 (absent in canva, stripe) |
| `brandColor` | string (`#RRGGBB`) | 14/16 (absent in canva, stripe) |

## `.mcp.json` schema — WRAPPED shape

Referenced from `plugin.json.mcpServers` (path). File contents:

```json
{
  "mcpServers": {
    "<server-name-1>": {
      "type": "http",
      "url": "https://..."
    },
    "<server-name-2>": {
      "command": "npx",
      "args": ["-y", "some-package"]
    }
  }
}
```

Note the outer `mcpServers` wrapper key. This is **different** from Claude's flat shape.

Translator handles the wrap/unwrap explicitly — see [`11-manifest-translator-algorithm.md`](11-manifest-translator-algorithm.md).

## `.app.json` schema

Referenced from `plugin.json.apps` (path). Connector/app registry:

```json
{
  "apps": {
    "canva": { "id": "connector_c0ffee..." },
    "github": { "id": "connector_abc123..." }
  }
}
```

Values are Codex connector identifiers. These represent OAuth-backed integrations into host services. No Claude equivalent exists — on Codex→Claude translation, stash in sidecar and emit `docs/codex-apps.notes.md`.

## `hooks.json` schema

Root-level file (not under `hooks/` like Claude's). Observed shape matches Claude's:

```json
{
  "description": "optional",
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "./scripts/post.sh" }
        ]
      }
    ]
  }
}
```

Event support (confirmed in corpus): `PostToolUse` (figma plugin).
Event support (not confirmed): `PreToolUse`, `Stop`, `SessionStart`, `UserPromptSubmit`. See [Spike S4](../../../docs/spikes/mcp-client-parity.md).

## `skills/<skill>/` structure

Identical to Claude's: `SKILL.md` + `references/` + `scripts/` + `assets/`. Key differences:

- Codex SKILL.md frontmatter uses only `name` and `description` in observed samples (no `allowed-tools`, `disable-model-invocation`, `user-invocable`)
- Some Codex skills have a **nested** `skills/<skill>/agents/openai.yaml` — skill-level interface descriptor with: `display_name`, `short_description`, `icon_small`, `icon_large`, `brand_color`, `default_prompt`
- Some Codex skills have a nested `skills/<skill>/agents/*.md` — skill-scoped agent definitions

Pure Claude plugins don't have nested skill agents or skill-level YAML interfaces. Translator must **flatten** on Codex→Claude (or stash + emit HTML-comment shim in SKILL.md body).

## `agents/` directory

Codex plugins ship an `agents/openai.yaml` file at plugin level that mirrors `interface{}` but in YAML. Observed in most plugins. Plus standard `*.md` agent definitions (same shape as Claude).

Translator:
- Claude→Codex: synthesize `openai.yaml` from `interface{}` when generating
- Codex→Claude: discard `openai.yaml` (data is already in canonical `interface` field)

## Marketplace catalog: `marketplace.json`

Located at `<repo>/.agents/plugins/marketplace.json`. Format observed TBD in Phase 3 when we generate one via the bridge Worker; specification derived from observed plugin-list patterns.

Proposed shape (consistent with Claude's):

```json
{
  "name": "openai-curated",
  "description": "OpenAI-curated plugins",
  "owner": { "name": "OpenAI", "url": "https://openai.com" },
  "plugins": [
    {
      "name": "canva",
      "source": "./canva/fb0a18376bcd9f2604047fbe7459ec5aed70c64b",
      "version": "1.0.0"
    },
    ...
  ]
}
```

Bridge Worker emits this dynamically at `GET /.agents/plugins/marketplace.json` from D1 queries — see [`05-cloudflare-workers-playbook.md`](05-cloudflare-workers-playbook.md).

## Codex config registration

Users register plugins in `~/.codex/config.toml`:

```toml
[plugins."<plugin-name>@<marketplace-name>"]
enabled = true
```

Observed real config (from Austin's machine):

```toml
[plugins."github@openai-curated"]
enabled = true

[plugins."cloudflare@openai-curated"]
enabled = true
```

The `<plugin-name>@<marketplace-name>` form is namespace-qualified.

For MCP servers registered outside plugins:

```toml
[mcp_servers.<server-name>]
command = "npx"
args = ["-y", "@blazesportsintel/universal-skills-mcp"]
```

This is **expected** syntax (not yet confirmed) — to be verified in Phase 2 P2-9.

## Real examples in `assets/real-examples/`

- `openai-canva-plugin.json` — verbatim from `~/.codex/plugins/cache/openai-curated/canva/.../plugin.json`. Shows minimal author (`{url}` only), empty keywords, `apps` pointer, no `mcpServers`, no `developerName`/`brandColor`.
- `openai-cloudflare-plugin.json` — shows `mcpServers` pointer, full author object, `commands/` directory convention.
- `openai-github-plugin.json` — shows `apps` with connector ID.
- `openai-figma-plugin.json` — the only plugin with `hooks` field, exercises `PostToolUse`.

Each annotated with absolute source path.

## Gotchas

- **`license` is a free-form string, not strictly SPDX.** Observed: `MIT`, `Apache-2.0`, `Proprietary`, `LicenseRef-Figma-Developer-Terms`. Translator must not coerce to enum.
- **`repository` may be malformed.** `life-science-research` uses `github.com/openai/openai/tree/master/plugins/life-science-research` (double `openai`) — preserve verbatim, don't "fix."
- **Nested skill agents** are Codex-only. Flattening on Claude target loses the nesting hierarchy → logged as lossy; reversal restores from sidecar.
- **`defaultPrompt` is union-typed.** Canonical form is always `array<string>`; single-string inputs become `[value]`.
- **Hidden dot-prefixed dirs (`.agents/`, `.codex-plugin/`) vs non-dot (`agents/`, `commands/`)** — not the same. `.codex-plugin/` holds the manifest; `agents/` holds content. Parser must respect this.

## Source references

- `~/.codex/plugins/cache/openai-curated/<plugin>/fb0a18376bcd9f2604047fbe7459ec5aed70c64b/.codex-plugin/plugin.json` × 16 plugins
- `~/.codex/config.toml` (live real config)
- [`docs/spikes/codex-schema-drift.md`](../../../docs/spikes/codex-schema-drift.md) — field frequency table + translator implications
- [`schema/codex-plugin.schema.json`](../../../schema/codex-plugin.schema.json) — machine-readable schema
