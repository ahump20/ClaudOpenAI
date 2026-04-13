# Fixtures

Test fixtures for the translator, scorer, and frontmatter parser. Referenced from `packages/mcp-server/tests/` via relative symlink.

## Subdirectories

### `known-good/`
Valid canonical records + SKILL.md documents with known expected behavior.

- `openai-pdf-skill.canonical.json` — synthetic high-quality PDF skill; `scoreSkill()` expected >= 70 (prompt line 147 invariant)
- `minimal-stub.canonical.json` — intentional low-quality stub; expected score < 30

### `lossy-cases/`
Inputs that intentionally exercise lossy translation paths. Each fixture declares the expected `translation_log` entries in a companion field.

- `claude-with-allowed-tools.json` — Claude frontmatter with `allowed-tools`; must round-trip via `codex_ecosystem.json` sidecar
- `codex-with-interface-and-apps.json` — Codex plugin with full `interface{}` block + connector `apps`; must round-trip via sidecar

### `malformed/`
Inputs that should fail validation with typed errors.

- `missing-frontmatter.md` — no YAML frontmatter; `InvalidFrontmatterError`
- `invalid-yaml.md` — unclosed bracket in frontmatter; `YAMLParseError`

## Adding new fixtures

1. Drop the file into the right subdirectory
2. Update `packages/mcp-server/tests/fixtures.ts` to enumerate it
3. Add a corresponding test case
4. `npm run test:unit` should pass

Scope is deliberately **additive** — existing fixtures are ground truth; don't edit without updating expected behavior in corresponding tests.
