# 01 — agentskills.io Spec Walkthrough

The shared skill format between Claude Code and OpenAI Codex. Also adopted (per the source prompt) by JetBrains Junie, Google AI Edge, and others. Apache 2.0 open standard.

> **Provenance caveat:** `agentskills.io` as a canonical hosted spec URL is not yet verified in Phase 0 (see [`docs/spikes/agentskills-provenance.md`](../../../docs/spikes/agentskills-provenance.md)). This reference is **derived from observed behavior** of 35+ Claude-ecosystem and 16 Codex-ecosystem skills plus Anthropic's own `plugin-dev` + `skill-creator` skill authoring skills. If `agentskills.io` resolves and publishes an authoritative version, we prefer it; lacking that, this observational doc is the working spec.

## What a skill IS

A skill is a **progressive-disclosure capability module** that an LLM-backed agent loads on demand when a trigger matches. Anatomy:

```
<skill-name>/
├── SKILL.md              # 1 file, ≤~100 lines, YAML frontmatter + markdown body
├── references/           # N files, optional, loaded when main SKILL.md routes to them
│   ├── 00-overview.md
│   └── ...
├── scripts/              # N files, optional, executable or source scripts
│   ├── validate.sh
│   └── ...
└── assets/               # N files/dirs, optional, templates/fixtures/binaries
    ├── templates/
    ├── real-examples/
    └── fixtures/
```

The **router pattern** (adopted by BSI skills, skill-creator, and most Anthropic first-party skills):
- `SKILL.md` is a dispatcher (≤100 lines)
- Workflows extracted to `references/`
- Templates + real examples in `assets/`
- Validators + scaffolders in `scripts/`

## Frontmatter schema (union of observed keys)

```yaml
---
name: my-skill                          # REQUIRED — kebab-case slug
description: |                          # REQUIRED — trigger copy, includes keywords/phrases
  Use when X is needed. Triggers: "X", "Y", "Z".
version: 0.1.0                          # optional — semver
allowed-tools: [Read, Edit, Bash]       # optional (Claude-only) — runtime tool gating
disable-model-invocation: true          # optional (Claude-only) — true = slash-command only
user-invocable: true                    # optional (Claude-only) — true = in slash menu
color: "#BF5700"                        # optional — UI accent (Claude)
model: claude-sonnet-4-5                # optional — model override (agent files only)
tools: [Read, Grep]                     # optional (agent.md only, not SKILL.md)
---
```

### The `description` field is load-bearing

It's what the host LLM reads to decide whether to auto-invoke the skill. Write it like a trigger copy ad:

- Say what scenarios trigger it ("Use when the user asks to X")
- Include keywords the user might say ("Triggers on 'X', 'Y', 'Z'")
- Keep to ≤3 sentences — context is expensive

Example (from our own SKILL.md):

> Use when building, designing, extending, or consuming the ClaudOpenAI unofficial cross-ecosystem skills marketplace — a Context7-pattern MCP server that bridges Claude Code (.claude-plugin) and OpenAI Codex (.codex-plugin) skill catalogs. Triggers on "universal skills", "skills marketplace", "cross-ecosystem skill", ...

## Progressive disclosure — the core design pattern

The LLM loads `SKILL.md` first (router). The router dispatches to specific `references/<topic>.md` files only when the user's intent matches. This keeps token cost low and context focused.

**Anti-pattern:** a single 400-line SKILL.md that dumps everything.
**Pattern:** a 60-line SKILL.md with a routing table pointing to 12 smaller references.

The BSI skill discipline (from `BSI-repo/skill-improvements/`) enforces `≤100 lines` in SKILL.md. Violations flagged by `validate.sh`.

## Body conventions

Markdown body follows:
1. One-line mission statement below frontmatter
2. Routing table or phase dispatcher
3. Cross-links to `references/<n>.md` for deep content
4. Link to `scripts/validate.sh` / other tooling
5. Explicit list of hard rules (security, data protection, anti-fabrication, etc.)

## `references/` conventions

Numbered prefixes (`00-`, `01-`, ..., `11-`, `12-`) make ordering explicit. Topic per file. Each reference file is self-contained — the LLM can load one without the others.

Cross-linking format: relative paths like `[...](08-github-indexer-design.md)`. Tools verify no broken links.

## `scripts/` conventions

- `validate.sh` — structural self-check. Required. Exit code 0 = skill valid.
- `scaffold.sh` — generate new instances from templates. Optional but common.
- `*.ts` / `*.py` — per-purpose scripts. Executables marked chmod +x in the skill package.

Environment variable `${CLAUDE_PLUGIN_ROOT}` (Claude) or `${CODEX_PLUGIN_ROOT}` (Codex — unverified name) resolves at runtime to the installed plugin root.

## `assets/` conventions

Common subdirs:
- `templates/` — `{{mustache}}` or empty placeholders for scaffolding
- `real-examples/` — verbatim copies of canonical real-world artifacts, annotated with source paths
- `fixtures/` — test inputs, both valid and intentionally-malformed
- `schemas/` — JSON Schema or zod schema files
- `diagrams/` — exported PNG/SVG (Mermaid sources in `docs/sequence-diagrams/`)

## Cross-ecosystem compatibility

When the same skill is consumed by both Claude Code and Codex:

- **Claude-only frontmatter keys** (`allowed-tools`, `disable-model-invocation`, `user-invocable`) are lossy on Codex target. Translator preserves them as HTML-comment shims in the SKILL.md body + ecosystem sidecar JSON.
- **Codex-only structure** (`agents/openai.yaml` at skill scope, nested skill agents) is lossy on Claude target. Preserved similarly.
- **Observable everywhere:** `name`, `description`, the body itself, and the three progressive-disclosure dirs.

## Versioning

Semver in `version` field. Backwards-compatibility conventions are not formally specified — in practice Claude and Codex both ignore the `version` key at load time. Marketplaces use it for listing.

## Validation

The `validate.sh` shell script (per BSI skill discipline) checks:

1. `SKILL.md` exists and is ≤100 lines
2. Frontmatter is valid YAML
3. Required keys (`name`, `description`) present
4. `name` matches directory name
5. All `references/`, `scripts/`, `assets/` paths referenced from SKILL.md actually exist
6. No broken intra-skill relative links
7. `scripts/` files are executable where shell scripts

Invalid skills fail pre-commit and fail `skill-creator` packaging.

## Packaging

Skills are packaged as `.skill` files: ZIP (deflate) archives of the entire skill dir tree. The `skill-creator` plugin's `scripts/package_skill.py` implements the canonical packager:

```bash
# From skill-creator (Anthropic)
~/.claude/plugins/cache/claude-plugins-official/skill-creator/unknown/skills/skill-creator/scripts/package_skill.py <skill-dir> <output.skill>
```

Our `scripts/package-skill.sh` wraps this.

## Installation

Skills install to:
- `~/.claude/skills/<skill-name>/` (Claude user scope)
- `.claude/skills/<skill-name>/` (Claude project scope — repo-local)
- `~/.codex/skills/<skill-name>/` (Codex user scope)
- `.codex/skills/<skill-name>/` (Codex project scope)

Or embedded inside a plugin at `<plugin>/skills/<skill>/`.

## Cross-references

- Anthropic's `plugin-dev/skills/skill-development/SKILL.md` — authoring guide, first-party
- Anthropic's `skill-creator/skills/skill-creator/SKILL.md` — templates + scaffolding
- Observed Codex examples at `~/.codex/plugins/cache/openai-curated/<plugin>/skills/<skill>/SKILL.md`
- BSI skill examples at `BSI-repo/skill-improvements/*/SKILL.md`

## What this ClaudOpenAI skill contributes

A **router SKILL.md** pointing to 12 deep-dive references. This doc is #01 of those 12. Read the others:

- [`00-architecture-overview.md`](00-architecture-overview.md) — the whole system
- [`02-claude-plugin-format.md`](02-claude-plugin-format.md) — Claude-side detail
- [`03-codex-plugin-format.md`](03-codex-plugin-format.md) — Codex-side detail
- ... through [`12-verification-playbook.md`](12-verification-playbook.md)
