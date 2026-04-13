# Spike S1 — Upstream Repo Availability

**Run:** 2026-04-12 (verified via GitHub REST API, unauthenticated).
**Purpose:** Confirm each upstream URL resolves before the indexer targets it. Per Anti-Fabrication Protocol, ghost repos must be dropped from scope.

## Results

All 9 target repos verified (HTTP 200 on `GET /repos/{owner}/{name}`). Includes one **addition** discovered via S2 (Codex plugins `repository` field): `openai/plugins`.

| # | Repo | ⭐ Stars | License | Default branch | Last push | Notes |
|---|------|---------|---------|----------------|-----------|-------|
| 1 | `anthropics/claude-plugins-official` | 16,781 | none* | main | 2026-04-12 | Official Claude Code marketplace |
| 2 | `anthropics/skills` | **115,874** | none* | main | 2026-04-09 | Public repository for Agent Skills |
| 3 | `anthropics/knowledge-work-plugins` | 11,132 | Apache-2.0 | main | 2026-04-10 | Plugins for Claude Cowork users |
| 4 | `openai/codex` | 74,829 | Apache-2.0 | main | 2026-04-13 | Lightweight coding agent |
| 5 | `openai/codex-plugin-cc` | 13,816 | Apache-2.0 | main | 2026-04-08 | **"Use Codex from Claude Code"** — prior-art bridge |
| 6 | `openai/skills` | 16,679 | none* | main | 2026-04-10 | Skills Catalog for Codex |
| 7 | `openai/swarm` | 21,297 | MIT | main | 2025-03-11 | **Stale — 13 months since last push** |
| 8 | `openai/openai-agents-python` | 20,737 | MIT | main | 2026-04-13 | Agents SDK framework |
| 9 | `openai/plugins` | 778 | none* | main | 2026-04-11 | **Auto-discovered** — hosts the 17 installed `openai-curated` Codex plugins (every local `plugin.json` has `"repository": "https://github.com/openai/plugins"`) |

*"none" = no SPDX license detected on the repo metadata; the repos themselves may still ship a LICENSE file. Indexer must re-check at `HEAD^{tree}/LICENSE` before republishing content.

## Indexer priority tiers

- **Tier A — live active, Apache/MIT, daily-pushed:** `anthropics/knowledge-work-plugins`, `openai/codex`, `openai/codex-plugin-cc`, `openai/openai-agents-python`. Poll every 6h (Phase 3 cron default).
- **Tier B — live active, license-needs-inspection:** `anthropics/claude-plugins-official`, `anthropics/skills`, `openai/skills`, `openai/plugins`. Poll every 6h. Per-file LICENSE check on first index.
- **Tier C — semi-stale:** `openai/swarm` (13 months). Poll every 24h. Flag with `"activity": "dormant"` in canonical record.

## Prior-art callout: `openai/codex-plugin-cc`

The `openai/codex-plugin-cc` repo — an Apache 2.0 package at 13.8K stars — already implements a one-way bridge ("Use Codex from Claude Code"). This is **relevant prior art** for ClaudOpenAI's translator and install-skill tool. Treat it as a reference; study its interface; do not reinvent what it already solves. Spike follow-on: clone and inspect after scaffold lands.

## Conclusion

Green light for all 9 repos. No URL changes needed. `openai/plugins` added to the indexer scope (brings the Codex plugin catalog directly rather than relying solely on cached local `~/.codex/plugins/` installs).
