# Spike S6 — agentskills.io Provenance

**Question:** Is `agentskills.io` a real, versioned, maintained spec? What's its canonical source?

**Status:** Partial. Resolving via web research at execution time (Phase 0). Treat this spike's conclusions as provisional until live verified via WebFetch.

## Evidence collected

### From the source prompt (line 12)
> The Agent Skills standard (agentskills.io, Apache 2.0) is an open format originated by Anthropic and adopted by OpenAI Codex, JetBrains Junie, Google AI Edge, and others.

### From installed skill files
- `SKILL.md` with YAML frontmatter (`name`, `description`, optional `version`, optional `allowed-tools`, optional `disable-model-invocation`, optional `user-invocable`) is consistent across Claude Code skills (~35 first-party plugins surveyed) AND Codex skills (16 openai-curated plugins surveyed).
- Progressive disclosure (references/ + scripts/ + assets/) is the de facto pattern in both.
- Apache 2.0 LICENSE files accompany `anthropics/knowledge-work-plugins` (confirmed in S1), `openai/codex`, `openai/codex-plugin-cc`.

### Known repo candidates to verify at execution
- `agentskills/agentskills` — guessed by the source prompt, **not verified**
- `anthropics/agent-skills` — plausible alt, **not verified**
- agentskills.io domain — **not yet WebFetch'd**; execution plan hits this in Phase 1 authoring of `references/01-agentskills-io-spec-walkthrough.md`

## Risk if the canonical URL doesn't exist

LOW. The spec's observable behavior is consistent across both ecosystems' installed skills. We can derive the reference doc from:
1. Real SKILL.md frontmatter observed in 16 Codex + 35+ Claude plugins
2. Anthropic's `plugin-dev` skill's `skill-development` sub-skill at `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/plugin-dev/skills/skill-development/` — authoritative on Claude side
3. The `skill-creator` plugin at `~/.claude/plugins/cache/claude-plugins-official/skill-creator/unknown/skills/skill-creator/` — authoritative scaffolding

Even if `agentskills.io` goes down or has never existed, our `references/01-agentskills-io-spec-walkthrough.md` can function as a derived-from-observation spec walkthrough, citing the real installed plugin examples as evidence.

## Action

During Phase 1 authoring of `references/01-agentskills-io-spec-walkthrough.md`:
1. WebFetch `https://agentskills.io/`, `https://agentskills.io/spec`, `https://github.com/agentskills/agentskills` — record actual status
2. If real: cite with version + permalink
3. If missing: label the reference as "Derived agent-skills spec (observational)" with a note explaining provenance

Per Anti-Fabrication Protocol, do not claim the spec URL as authoritative unless verified.

## Conclusion

No blocker. Proceed. Verify URL at reference-writing time; pivot to observational spec if URL is dead.
