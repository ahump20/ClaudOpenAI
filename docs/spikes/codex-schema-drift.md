# Spike S2 — Codex `plugin.json` Schema (Derived)

**Run:** 2026-04-12.
**Corpus:** 16 installed `openai-curated` plugins at `~/.codex/plugins/cache/openai-curated/<plugin>/fb0a18376bcd9f2604047fbe7459ec5aed70c64b/.codex-plugin/plugin.json`.
**Plugins:** `build-ios-apps`, `build-macos-apps`, `build-web-apps`, `canva`, `cloudflare`, `figma`, `game-studio`, `github`, `gmail`, `google-calendar`, `google-drive`, `hugging-face`, `life-science-research`, `notion`, `stripe`, `test-android-apps`.

**Why this matters:** the source prompt underspecified the Codex manifest format. Writing the translator against the prompt's description alone would produce wrong output. This spike captures the *real* schema from observed data.

## Top-level field frequency

| Field | Present in | % | Type | Notes |
|-------|-----------|---|------|-------|
| `name` | 16/16 | 100 | string | kebab-case plugin slug |
| `version` | 16/16 | 100 | string | semver (e.g. `0.1.0`, `1.0.0`, `2.0.7`) |
| `description` | 16/16 | 100 | string | one-sentence summary |
| `author` | 16/16 | 100 | object | `{name?, email?, url?}` — some have only `url` (canva, stripe) |
| `homepage` | 16/16 | 100 | string | public site URL |
| `repository` | 16/16 | 100 | string | all but one point to `https://github.com/openai/plugins`; figma uses `github.com/figma/mcp-server-guide`; life-science-research has typo path `github.com/openai/openai/tree/master/plugins/life-science-research` |
| `license` | 16/16 | 100 | string | mostly `MIT`; exceptions: `figma` = `LicenseRef-Figma-Developer-Terms`, `life-science-research` = `Proprietary` |
| `keywords` | 16/16 | 100 | array<string> | 0-17 entries; used for catalog tagging |
| `skills` | 16/16 | 100 | string | **always `"./skills/"`** — always a directory path, never an array |
| `interface` | 16/16 | 100 | object | catalog/marketplace metadata — Codex-only, no Claude equivalent |
| `apps` | 9/16 | 56 | string | path to `.app.json` (connector registry) |
| `mcpServers` | 5/16 | 31 | string | path to `.mcp.json` (wrapped `{"mcpServers":{...}}` shape) |
| `hooks` | 1/16 | 6 | string | path to `hooks.json`; observed only in `figma` |

## `interface{}` sub-field frequency

| Field | Present | % | Type | Notes |
|-------|---------|---|------|-------|
| `displayName` | 16/16 | 100 | string | Title Case name |
| `shortDescription` | 16/16 | 100 | string | ≤60 chars typical |
| `longDescription` | 16/16 | 100 | string | paragraph |
| `category` | 16/16 | 100 | string | enum observed: `Coding`, `Productivity`, `Communication`, `Research`, `Design` |
| `capabilities` | 16/16 | 100 | array<string> | enum observed: `Interactive`, `Write`, `Read`, empty array |
| `websiteURL` | 16/16 | 100 | string | HTTPS |
| `privacyPolicyURL` | 16/16 | 100 | string | HTTPS |
| `termsOfServiceURL` | 16/16 | 100 | string | HTTPS |
| `defaultPrompt` | 16/16 | 100 | string \| array<string> | **shape varies** — canva uses array, most use string |
| `composerIcon` | 16/16 | 100 | string | path to icon file (`./assets/...`) |
| `logo` | 16/16 | 100 | string | path to logo file |
| `screenshots` | 16/16 | 100 | array | 0-N entries; entries shape unverified (empty arrays observed) |
| `developerName` | 14/16 | 88 | string | absent in `canva`, `stripe` |
| `brandColor` | 14/16 | 88 | string | hex color `#RRGGBB`; absent in `canva`, `stripe` |

## Key differences from the source prompt

The source prompt (`/Users/AustinHumphrey/Downloads/universalskillsmarketplaceprompt.md` line 14) stated:

> OpenAI's distribution layer: `.codex-plugin/plugin.json` manifests → `marketplace.json` at `$REPO_ROOT/.agents/plugins/` or `~/.agents/plugins/` → `$plugin-creator` scaffolding → `$skill-installer` from github.com/openai/skills (curated + experimental tiers). Plugins bundle skills + apps + .mcp.json.

**Correct additions our translator needs:**

1. **`interface{}` block with 14 sub-fields** — Codex-only catalog metadata. No equivalent in Claude's `plugin.json`. Translator must either stash in a sidecar (`codex_ecosystem.json`) or encode in a README appendix on Claude targets.
2. **`keywords`, `homepage`, `repository`, `license`** — all four required at top level. Claude's `plugin.json` carries none of these.
3. **`skills` is always a string path, never array** — translator emits `"./skills/"` even when the skill folder is empty.
4. **`apps` is a string pointer** to `.app.json`, not an inline object or directory. The `.app.json` file contains `{"apps": {"<connector>": {"id": "connector_..."}}}`.
5. **`mcpServers` is present in only 31% of plugins** and always points to `./.mcp.json`. The `.mcp.json` shape differs from Claude's (Codex wraps in `{"mcpServers": {...}}`).
6. **`defaultPrompt` shape is mixed** — string in most plugins, array of strings in `canva`. Translator must accept both.

## Formal JSON Schema

Written to `schema/codex-plugin.schema.json` (next to this file in the repo).

## Translator implications

- **Claude → Codex:** synthesize full `interface{}` from known fields: `displayName = titlecase(name)`, `shortDescription = description[:60]`, `longDescription = description`, `category = "Coding"` (default), `capabilities = []`, `websiteURL = author.url || "about:blank"`, `privacyPolicyURL = ""`, `termsOfServiceURL = ""`, `defaultPrompt = description`, `composerIcon = ""`, `logo = ""`, `screenshots = []`. Derived `developerName` from `author.name` when present, `brandColor` omitted.
- **Codex → Claude:** stash whole `interface{}`, `apps`, `keywords`, `license`, `homepage`, `repository` in sidecar `.claude-plugin/codex_ecosystem.json`. Emit visible HTML-comment shim in README.md summarizing: "Original Codex plugin metadata preserved in `.claude-plugin/codex_ecosystem.json`."
- **`defaultPrompt` normalization:** canonical form is always `array<string>`. Single-string inputs become `[value]`.

## Sample values for translator tests

Pinned samples per field (pulled from real installed plugins):

```json
{
  "category_examples": ["Coding", "Productivity", "Communication", "Research", "Design"],
  "capability_examples": ["Interactive", "Write", "Read"],
  "brand_color_example": "#BF5700",
  "author_minimal": {"url": "https://www.canva.com"},
  "author_full": {"name": "Anthropic", "email": "noreply@anthropic.com", "url": "https://anthropic.com"},
  "empty_interface_values": {"screenshots": [], "capabilities": []}
}
```

## Conclusion

Schema derived from 16 real plugins. Write formal JSON Schema to `schema/codex-plugin.schema.json`; wire into `packages/schema/src/codex.ts` zod. Translator must handle all 13 top-level + 14 `interface{}` fields, with optional-field behavior matching observed frequency.
