# 11 — Manifest Translator Algorithm

The hardest component. Transforms between `ClaudePlugin` (`.claude-plugin/plugin.json` + convention dirs), `CodexPlugin` (`.codex-plugin/plugin.json` with rich `interface{}` block), and `StandaloneSkill` (bare SKILL.md + `references/` / `scripts/` / `assets/`). Operates through a canonical intermediate format (`CanonicalSkill`) — never directly between endpoints.

This document is the **specification** for `packages/mcp-server/src/lib/translator.ts`.

## Why a canonical middle layer

- **Symmetry**: one set of translator functions (`toCanonical`, `fromCanonical`) instead of 6 pairwise converters
- **Versionability**: canonical schema v1 serves clients that need v0 via adapter; canonical v2 adapters live alongside v1
- **Lossy tracking**: fields that don't fit the target survive in `translation_log` + `ecosystem_extensions`; sidecar files encode everything losslessly
- **Testability**: round-trip identity = `fromCanonical(toCanonical(x), x.origin.type) === x` (modulo logged lossy fields, recovered from sidecar)

## Field compatibility matrix (derived from real files)

Built from reading:
- 16 installed Codex plugins at `~/.codex/plugins/cache/openai-curated/*/**/plugin.json`
- 35+ Claude plugins at `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/*/plugin.json` and `external_plugins/*/plugin.json`
- 3 BSI standalone skills at `BSI-repo/skill-improvements/*/SKILL.md`
- Spike S2 output at `docs/spikes/codex-schema-drift.md`

### Top-level plugin manifest

| Field | Claude plugin.json | Codex plugin.json | Standalone SKILL.md | Translation |
|-------|--------------------|--------------------|----------------------|-------------|
| `name` | required | required | frontmatter `name` | identical |
| `description` | required | required | frontmatter `description` | identical |
| `version` | absent in official marketplace samples | always present | optional frontmatter | Claude→Codex: default `"0.0.1"` with `translation_log.info`. Codex→Claude: preserve as top-level field (Claude tolerates unknown keys); also stash in `.claude-plugin/codex_ecosystem.json` for round-trip recovery. |
| `author` | `{name, email}` typical | `{name?, email?, url?}` | n/a | near-identical. Translator handles the `name`-only or `url`-only variants. |
| `homepage` | not observed | always present | n/a | Codex→Claude: Claude has no slot. Stash in `codex_ecosystem.json`. Claude→Codex: derive from `author.url` OR leave empty. |
| `repository` | not observed | always present | n/a | Same as `homepage`. |
| `license` | not observed in plugin.json (sibling LICENSE file) | always present | n/a | Same. For Claude→Codex without a LICENSE sibling, default `"UNLICENSED"` + warning. |
| `keywords` | not observed | always present (0-17 items) | n/a | Codex→Claude: stash in sidecar. Claude→Codex: empty array. |
| `skills` | implicit convention: walk `./skills/` | explicit string `"./skills/"` | the plugin IS a skill | Codex→Claude: drop field, keep directory. Claude→Codex: emit `"./skills/"` when `./skills/` dir has any SKILL.md. |
| `mcpServers` | NOT in plugin.json; file is `./.mcp.json` (flat shape) | path string `"./.mcp.json"` (wrapped shape) | n/a | **Shape conversion required** — see "`.mcp.json` handling" below. |
| `hooks` | NOT in plugin.json; file is `./hooks/hooks.json` | path string `"./hooks.json"` | n/a | Path relocation. |
| `commands` | implicit convention: walk `./commands/` | implicit (observed in cloudflare, figma, build-macos-apps) | n/a | Pass-through by dir walk. No field mapping needed. |
| `agents` | implicit convention: walk `./agents/` | implicit + additional `agents/openai.yaml` interface sibling | n/a | Most `*.md` agents pass through. The `openai.yaml` descriptor gets consumed into `interface{}` on canonical. |
| `apps` | not supported | `./.app.json` (connector registry) | n/a | **Codex-only**. Claude→Codex: omit. Codex→Claude: lossy — stash raw `.app.json` contents in `codex_ecosystem.json.apps`; emit `docs/codex-apps.notes.md` shim documenting the lost connectors. |
| `interface` | not supported | full block (13+ fields) | n/a | **Codex-only**. Synthesize minimal block on Claude→Codex. Stash full block on Codex→Claude. |

### `.mcp.json` handling

Both ecosystems share the `./.mcp.json` filename. The **shape differs**:

```json
// Claude (~/.claude/mcp.json OR <plugin>/.mcp.json)  — FLAT
{
  "<server-name>": { "command": "...", "args": [...] }
}

// Codex (<plugin>/.mcp.json)  — WRAPPED
{
  "mcpServers": {
    "<server-name>": { "command": "...", "args": [...] }
  }
}
```

**Claude → Codex:** wrap `{ ..., mcpServers: "./.mcp.json" }` field in plugin.json; rewrite `.mcp.json` with `{ "mcpServers": { <existing-content> } }`.

**Codex → Claude:** drop `mcpServers` pointer from plugin.json (Claude reads convention); rewrite `.mcp.json` by unwrapping `.mcpServers` value.

### `hooks.json` handling

Claude: `<plugin>/hooks/hooks.json` (subdir).
Codex: `<plugin>/hooks.json` (root).

Both share the event+matcher schema (`PreToolUse`, `PostToolUse`, etc.) — see Anthropic plugin-dev hooks reference for the canonical shape. Translator moves the file between locations.

**Hook event support parity** — not all events are confirmed on both sides:

| Event | Claude | Codex (observed) | Translation |
|-------|--------|-----------------|-------------|
| `PreToolUse` | ✓ | unverified | Pass through; warn Codex support TBD |
| `PostToolUse` | ✓ | ✓ (figma plugin) | Pass through cleanly |
| `Stop` | ✓ | unverified | Pass through + fallback shim: emit `PostToolUse` with matcher `.*` noting it's a `Stop` downgrade; include `_translator_note_Stop` key |
| `SessionStart` | ✓ | unverified | Same fallback pattern |
| `UserPromptSubmit` | ✓ | unverified | Same fallback pattern |

Spike follow-up (`docs/spikes/mcp-client-parity.md` — extended in Phase 2): confirm Codex event support by running a test plugin.

### SKILL.md frontmatter

| Key | Claude | Codex | Canonical preserves |
|-----|--------|-------|---------------------|
| `name` | required | required | yes |
| `description` | required | required | yes |
| `version` | optional | not observed | yes |
| `allowed-tools` | observed (imessage plugin) | not observed | yes + warn Codex dropping |
| `disable-model-invocation` | observed | not observed | yes + HTML comment shim in body when Codex target |
| `user-invocable` | observed | not observed | yes + HTML comment shim |
| `color` | observed (agent frontmatter, not skill) | not observed | preserve |
| `model` | observed (agent frontmatter) | not observed | preserve |
| `tools` | observed (agent frontmatter) | not observed | preserve |

## Translation directions (pseudocode)

### Claude → Canonical

```
toCanonical(claude_plugin_dir):
  manifest = read(<dir>/.claude-plugin/plugin.json)

  // Validate input
  assert manifest.name is valid kebab-case
  assert manifest.description is non-empty

  // Walk convention dirs
  skills = []
  for each <dir>/skills/<skill_name>/:
    fm = parse_yaml_frontmatter(<skill_dir>/SKILL.md)
    body = read_md_body(<skill_dir>/SKILL.md)
    refs = glob(<skill_dir>/references/**/*)
    scripts = glob(<skill_dir>/scripts/**/*)
    assets = glob(<skill_dir>/assets/**/*)
    nested_agents = walk(<skill_dir>/agents/**/*.md)  // flatten
    skills.push({path, name: fm.name, description: fm.description, frontmatter: fm, body, references: refs, scripts, assets, nested_agents})

  agents = walk(<dir>/agents/**/*.md)
  commands = walk(<dir>/commands/**/*.md)
  hooks = read(<dir>/hooks/hooks.json) if exists else null
  mcpServers = unwrap_if_wrapped(read(<dir>/.mcp.json)) if exists else {}

  // Recover stashed Codex ecosystem data (if this plugin was previously Codex→Claude translated)
  codex_ext = read(<dir>/.claude-plugin/codex_ecosystem.json) if exists else {}

  return CanonicalSkill{
    id: manifest.name,
    origin: { ecosystem: "claude", sourcePath: abs(<dir>), sourceSha: git_head_sha(<dir>) or null },
    type: "plugin",
    name: manifest.name,
    description: manifest.description,
    version: manifest.version || codex_ext.version || null,
    author: manifest.author,
    homepage: codex_ext.homepage || null,
    repository: codex_ext.repository || null,
    license: codex_ext.license || null,
    keywords: codex_ext.keywords || [],
    skills: skills,
    mcpServers: mcpServers,
    commands: commands,
    hooks: hooks ? { description: hooks.description, events: hooks.hooks } : null,
    agents: agents,
    apps: codex_ext.apps || {},
    interface: codex_ext.interface || null,
    ecosystem_extensions: { claude: {}, codex: codex_ext },
    translation_log: [],
  }
```

### Codex → Canonical

```
toCanonical(codex_plugin_dir):
  manifest = read(<dir>/.codex-plugin/plugin.json)

  assert required fields: name, version, description, author, homepage, repository, license, keywords, skills, interface

  // Expand skills path into skill objects
  skills_dir = <dir>/ + manifest.skills
  skills = walk_skills(skills_dir)  // same as Claude

  // Handle apps pointer
  apps = {}
  if manifest.apps:
    apps_file = <dir>/ + manifest.apps
    apps = read_json(apps_file).apps

  // Handle mcpServers pointer with unwrap
  mcpServers = {}
  if manifest.mcpServers:
    mcp_file = <dir>/ + manifest.mcpServers
    raw = read_json(mcp_file)
    mcpServers = raw.mcpServers  // unwrap

  // Handle hooks
  hooks = null
  if manifest.hooks:
    hook_file = <dir>/ + manifest.hooks
    h = read_json(hook_file)
    hooks = { description: h.description || null, events: h.hooks || h }

  commands = walk_md_files(<dir>/commands/)  // if exists
  agents_md = walk_md_files(<dir>/agents/)   // *.md files only
  agent_yaml = read(<dir>/agents/openai.yaml) if exists else null  // Codex-specific plugin-level interface

  // Recover stashed Claude ecosystem data (if this was previously Claude→Codex)
  claude_ext = read(<dir>/.codex-plugin/claude_ecosystem.json) if exists else {}

  return CanonicalSkill{
    id: manifest.name,
    origin: { ecosystem: "codex", sourcePath: abs(<dir>), sourceSha: git_head_sha(<dir>) or null },
    type: "plugin",
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    author: manifest.author,
    homepage: manifest.homepage,
    repository: manifest.repository,
    license: manifest.license,
    keywords: manifest.keywords,
    skills: skills,
    mcpServers: mcpServers,
    commands: commands,
    hooks: hooks,
    agents: agents_md,
    apps: apps,
    interface: { ...manifest.interface, ...(agent_yaml || {}) },
    ecosystem_extensions: { codex: {}, claude: claude_ext },
    translation_log: [],
  }
```

### Canonical → Claude

```
fromCanonical(c, "claude"):
  log = []

  // Emit .claude-plugin/plugin.json — minimal by convention
  plugin_json = {
    name: c.name,
    description: c.description,
    author: c.author,
  }
  // Claude tolerates extra keys but the marketplace convention is minimal.
  // We preserve the rest in the ecosystem sidecar for round-trip.

  // Build codex_ecosystem.json sidecar (preserves ALL Codex-specific fields)
  sidecar = {
    version: c.version,
    homepage: c.homepage,
    repository: c.repository,
    license: c.license,
    keywords: c.keywords,
    apps: c.apps,
    interface: c.interface,
    skill_interfaces: { <skill_name>: <openai.yaml contents for that skill>, ... },
  }
  if any field in sidecar is non-null:
    write <out>/.claude-plugin/codex_ecosystem.json = sidecar
    log.push({ level: "info", field: "<various>", message: "Codex-specific metadata preserved in codex_ecosystem.json for round-trip" })

  // Emit .mcp.json (FLAT shape, Claude)
  if c.mcpServers is non-empty:
    write <out>/.mcp.json = c.mcpServers  // already flat in canonical

  // Emit hooks/hooks.json
  if c.hooks:
    mkdir <out>/hooks
    write <out>/hooks/hooks.json = {
      description: c.hooks.description || undefined,
      hooks: c.hooks.events,
    }

  // Emit skills/
  for skill in c.skills:
    <skill_out> = <out>/skills/<skill.name>/
    write <skill_out>/SKILL.md = serialize_frontmatter(skill.frontmatter) + "\n" + skill.body
    if skill.frontmatter has Codex-only keys (tracked via translation_log):
      prepend_html_comment(skill_body, "<!-- codex-preserved: ... -->")
    write references/, scripts/, assets/ as found

  // Emit agents/
  for agent in c.agents:
    write <out>/agents/<agent.name>.md = agent.body

  // Emit commands/ — same pattern
  for cmd in c.commands:
    write <out>/commands/<cmd.name>.md = cmd.body

  // Handle Codex-only `apps`
  if c.apps is non-empty:
    write <out>/docs/codex-apps.notes.md = render_apps_notes(c.apps)
    log.push({ level: "lossy", field: "apps", message: "Codex connector apps recorded in docs/codex-apps.notes.md", shim_generated: "docs/codex-apps.notes.md" })

  // Handle Codex `interface` block
  if c.interface is non-null:
    log.push({ level: "info", field: "interface", message: "Codex marketplace metadata preserved in .claude-plugin/codex_ecosystem.json" })

  return { out_dir: <out>, translation_log: log }
```

### Canonical → Codex

```
fromCanonical(c, "codex"):
  log = []

  // Emit .codex-plugin/plugin.json — rich by convention
  plugin_json = {
    name: c.name,
    version: c.version || "0.0.1",  // if Claude-origin, synthesize
    description: c.description,
    author: c.author || { name: "Unknown" },
    homepage: c.homepage || c.author?.url || "about:blank",
    repository: c.repository || "about:blank",  // warn
    license: c.license || "UNLICENSED",
    keywords: c.keywords || [],
    skills: c.skills.length > 0 ? "./skills/" : undefined,
    mcpServers: c.mcpServers is non-empty ? "./.mcp.json" : undefined,
    hooks: c.hooks ? "./hooks.json" : undefined,
    apps: c.apps is non-empty ? "./.app.json" : undefined,
    interface: c.interface || synthesize_interface(c),
  }
  if c.version is null:
    log.push({ level: "warning", field: "version", message: "No version in Claude source; defaulted to '0.0.1'" })

  synthesize_interface(c) returns:
    {
      displayName: titlecase(c.name),
      shortDescription: truncate(c.description, 60),
      longDescription: c.description,
      developerName: c.author?.name || "Unknown",
      category: "Coding",  // safe default
      capabilities: [],     // conservative
      websiteURL: c.homepage || c.author?.url || "about:blank",
      privacyPolicyURL: "",
      termsOfServiceURL: "",
      defaultPrompt: [`Use $${c.name} to ${first_sentence(c.description)}`],
      brandColor: undefined,  // Codex accepts missing
      composerIcon: "",
      logo: "",
      screenshots: [],
    }

  // Build claude_ecosystem.json sidecar
  sidecar = collect_claude_only_fields(c)  // any allowed-tools, disable-model-invocation from SKILL.mds, etc.
  if sidecar has any non-null value:
    write <out>/.codex-plugin/claude_ecosystem.json = sidecar

  // Emit .mcp.json (WRAPPED, Codex)
  if c.mcpServers non-empty:
    write <out>/.mcp.json = { mcpServers: c.mcpServers }

  // Emit hooks.json at root
  if c.hooks:
    write <out>/hooks.json = { description: c.hooks.description || null, hooks: c.hooks.events }
    for event in c.hooks.events where event not in {"PreToolUse", "PostToolUse"}:
      log.push({ level: "warning", field: `hooks.${event}`, message: `Codex support for ${event} unverified; emitted fallback PostToolUse shim`, shim_generated: `_translator_note_${event}` })

  // Emit .app.json
  if c.apps is non-empty:
    write <out>/.app.json = { apps: c.apps }

  // Emit skills — strip Claude-only frontmatter, preserve as HTML comments
  for skill in c.skills:
    frontmatter_for_codex = strip_keys(skill.frontmatter, ["allowed-tools", "disable-model-invocation", "user-invocable"])
    body = skill.body
    if any stripped keys:
      prepend_html_comment(body, generate_shim_comment(stripped))
      log.push({ level: "lossy", field: `skills.${skill.name}.frontmatter`, message: "Claude-only keys preserved as HTML comment", shim_generated: "<html-comment>" })
    write <skill_dir>/SKILL.md = serialize(frontmatter_for_codex) + "\n" + body

  // If skill has skillInterface (Codex-native openai.yaml), re-emit that file
  if skill.skill_interface:
    write <skill_dir>/agents/openai.yaml = skill.skill_interface

  // Emit agents, commands — pass through
  ...

  return { out_dir: <out>, translation_log: log }
```

### Standalone ↔ Claude / Codex

A standalone SKILL.md package (just the skill, no plugin wrapper) translates by **wrapping** into a minimal plugin. Name derived from directory or frontmatter. Similarly, Claude/Codex → standalone fails if the plugin has > 1 skill (ambiguous which to promote). On single-skill plugins, promotes `skills/<skill>/*` to root and drops the `.claude-plugin/` or `.codex-plugin/` dir.

## Compatibility shim generator

Every lossy translation produces one of:

**1. HTML-comment shim** — invisible to renderers, grep-able:
```html
<!-- translator-shim: original-ecosystem=claude field=disable-model-invocation value=true; codex equivalent: none; behavior: skill is model-invocable on Codex -->
```
Used for: SKILL.md frontmatter keys dropped on Codex target (allowed-tools, disable-model-invocation, user-invocable).

**2. Notes markdown shim** — new file documenting what was lost:
- `docs/codex-apps.notes.md` (when `.app.json` had connector IDs)
- `docs/codex-interface.notes.md` (when `interface{}` was substantial and we don't want it only in sidecar)
- `docs/claude-hooks-unsupported.notes.md` (when SessionStart/UserPromptSubmit hooks target Codex)

**3. Ecosystem sidecar JSON** — lossless preservation for round-trip:
- `.claude-plugin/codex_ecosystem.json` on Claude targets
- `.codex-plugin/claude_ecosystem.json` on Codex targets

Translator reads these sidecars on the reverse direction → enables true round-trip identity.

**4. Hook-event fallback shim** — for hooks Codex may not support:
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": [ ... original commands ... ],
        "_translator_note_Stop": "original Claude event 'Stop' downgraded to best-effort PostToolUse"
      }
    ]
  }
}
```

## Round-trip invariants (enforced in tests)

1. `claude → canonical → claude` — byte-identical `.md` files (modulo HTML shim comments reapplied), identical `plugin.json`, identical dir structure
2. `codex → canonical → codex` — byte-identical across all fields, `interface` preserved
3. `claude → canonical → codex → canonical → claude` — all semantic fields preserved via sidecar recovery; `translation_log` lists lossy steps
4. Deterministic output: parse the same plugin twice → produce byte-identical canonical JSON (stable field ordering)
5. Unknown upstream fields: warn + stash in `ecosystem_extensions.<src>.<field>`; never error or drop

## Test corpus

Lives at `skills/universal-skills-marketplace/assets/fixtures/` + `packages/mcp-server/tests/fixtures/`:

```
fixtures/
  claude/
    plugin-dev/                   (real)
    hookify/                      (tests allowed-tools, hooks)
    context7/                     (external, minimal)
    imessage/                     (tests user-invocable, allowed-tools)
    ... ≥15 more
  codex/
    canva/                        (tests interface, apps, nested skill agents)
    build-web-apps/               (tests mcpServers)
    figma/                        (tests hooks, commands)
    cloudflare/
    github/                       (tests apps)
    ... all 16 openai-curated
  standalone/
    bsi-gameday-ops/              (real BSI skill)
    college-baseball-intelligence/
    texas-longhorns-baseball-intelligence/
  lossy-cases/
    claude-with-allowed-tools.json
    claude-disable-model-invocation-true.json
    codex-with-app-json.json
    codex-with-custom-brandcolor.json
  malformed/
    missing-frontmatter.md
    invalid-yaml.md
    no-description.md
```

## Known unknowns (documented in `docs/spikes/`)

- **UK 1:** Does Codex support `Stop` / `SessionStart` / `UserPromptSubmit` hooks? Fallback shim works regardless, but true parity would let us drop the shim. Resolve by testing in Phase 2 P2-9.
- **UK 2:** Are `_translator_note_*` keys tolerated by the Codex hooks.json parser? If not, move to sidecar. Resolve in Phase 2.
- **UK 3:** `context: fork` — prompt claimed this Claude SKILL.md frontmatter key exists; not found in any surveyed SKILL.md. If real, add to matrix; if fabricated, drop from plan.

## Implementation

`packages/mcp-server/src/lib/translator.ts` — exports `toCanonical`, `fromCanonical`, `translateManifest`. Uses zod schemas from `packages/schema/src/{canonical,claude,codex}.ts`. Full test coverage gate: 90% branches.

## See also

- [`02-claude-plugin-format.md`](02-claude-plugin-format.md) — detailed Claude schema
- [`03-codex-plugin-format.md`](03-codex-plugin-format.md) — detailed Codex schema
- [`12-verification-playbook.md`](12-verification-playbook.md) — round-trip test matrix
- `docs/spikes/codex-schema-drift.md` — evidence base for Codex schema claims
