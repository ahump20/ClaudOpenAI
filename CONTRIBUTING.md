# Contributing to ClaudOpenAI

> Unofficial community project. Contributions welcome under [Apache 2.0](./LICENSE).

## Before you start

1. Read [CLAUDE.md](./CLAUDE.md) for the project's hard rules (Anti-Fabrication, Anti-Mock-Data, Verification Protocol, Translator Loudness).
2. Skim [ARCHITECTURE.md](./ARCHITECTURE.md) so you understand the sync → catalog → serve flow.
3. Check the phase in [`../../.claude/plans/zesty-growing-flurry.md`](../../.claude/plans/zesty-growing-flurry.md) — PRs must target the current phase, not leapfrog.

## Dev setup

```bash
git clone https://github.com/ahump20/ClaudOpenAI.git
cd ClaudOpenAI
npm ci
npm run build
npm test
bash skills/universal-skills-marketplace/scripts/validate.sh
```

## Adding a new upstream source to the indexer

1. Add the repo to `workers/universal-skills-indexer/src/lib/sources.ts`
2. Verify it resolves: `curl -s https://api.github.com/repos/{owner}/{name} | jq .full_name`
3. Add a new row to [`docs/spikes/upstream-availability.md`](./docs/spikes/upstream-availability.md)
4. Run indexer locally: `npm run dev:indexer -- --test-scheduled`
5. Confirm D1 populates without errors: `wrangler d1 execute universal-skills --command "SELECT count(*) FROM skills WHERE source_url LIKE '%{newrepo}%'"`

## Adding a field to CanonicalSkill

1. Update the zod schema at `packages/schema/src/canonical.ts`
2. Update the JSON Schema at `schema/canonical-skill.schema.json` (regenerate or hand-edit)
3. Update translator at `packages/mcp-server/src/lib/translator.ts` — both directions
4. Add a translator round-trip fixture under `skills/universal-skills-marketplace/assets/fixtures/` that exercises the new field
5. Run `npm run translator-roundtrip` — MUST pass
6. If field is lossy in either direction: document in `skills/universal-skills-marketplace/references/11-manifest-translator-algorithm.md`

## PR checklist

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes (all workspaces)
- [ ] `bash skills/universal-skills-marketplace/scripts/validate.sh` exits 0
- [ ] `npm run translator-roundtrip` passes
- [ ] If adding new upstream: spike doc updated
- [ ] If adding new field: round-trip fixture added + lossiness documented
- [ ] No new `Math.random()`, mock data, or hardcoded skill lists outside `tests/fixtures/`
- [ ] Changes align with current plan phase

## Commit style

```
type(scope): subject

body (optional, explains why not what)

Refs: #123
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `sec`.

Scopes: `schema`, `translator`, `scorer`, `registry`, `api`, `indexer`, `bridge`, `skill`, `docs`, `ci`.

## Reporting bugs

File an issue at `github.com/ahump20/ClaudOpenAI/issues` with:
- Minimal repro
- Your client (Claude Code / Codex / other MCP host) and version
- If a translator bug: a failing round-trip fixture we can add to the test corpus
- What you expected vs. what happened

## Code of conduct

Be helpful. Disagree technically; don't disparage personally. Remember this is an unofficial community project — nobody's getting paid to respond to your ticket, and that includes the maintainer.
