# 12 — Verification Playbook

End-to-end test matrix with specific commands and acceptance criteria. Matches the source prompt's VERIFICATION section (lines 141-159) and the plan file's §Verification section.

> **Canonical rule:** "Build passed" ≠ acceptance. Every phase deliverable must have observable evidence logged to `docs/verification-evidence/`.

## Three-tier verification

### Tier 1 — Unit (CI gate, every PR)

Runs on every push. Fast (<2 min). Blocks merge if any fails.

```bash
npm run typecheck
npm run lint
npm run test:unit -ws
bash skills/universal-skills-marketplace/scripts/validate.sh
node skills/universal-skills-marketplace/scripts/test-translator.ts --all-fixtures
```

Coverage gate: 85% line, 90% branch on `packages/*/src/lib/`.

Required unit assertions (non-exhaustive):

- **translator**: round-trip identity on all Claude fixtures (≥15) and Codex fixtures (16 real)
- **translator**: `allowed-tools` Claude→Codex→Claude preserves via `codex_ecosystem.json` sidecar; log entry level=`lossy`
- **scorer**: `scoreSkill(known-good/openai-pdf-skill.json, 16679) >= 70` (prompt line 147)
- **scorer**: deterministic — same input → same output twice
- **scorer**: breakdown sums to total
- **frontmatter**: valid YAML parses cleanly; malformed fixtures reject with typed errors
- **github-client**: ETag conditional request returns 304 when unchanged
- **github-client**: 429 response triggers `RateLimitExceededError` with `retry_after`
- **registry**: `resolveSkill("pdf")` against nock-stubbed GitHub returns expected shape
- **schema**: every fixture in `assets/fixtures/` validates against appropriate JSON Schema via `ajv`
- **schema**: malformed fixtures fail validation with typed errors

### Tier 2 — Integration (gated, nightly + pre-release)

Consumes real GitHub quota. Gated behind `CI_REAL_GITHUB=1` + secret PAT. Runs nightly on main branch; manually before tagged releases.

```bash
CI_REAL_GITHUB=1 npm run test:integration -w @blazesportsintel/universal-skills-mcp
```

Required integration assertions:

- `resolve-skill("pdf processing")` against real GitHub returns ≥3 results with required fields
- `get-skill-content` against a known real skill returns valid SKILL.md parseable frontmatter
- `install-skill(mode="command-only")` for a resolved Codex skill generates a valid Claude install command; syntax lint passes
- **MCP Inspector handshake**: `npx @modelcontextprotocol/inspector node packages/mcp-server/dist/index.js` shows all 3 tools with valid zod-derived JSON schemas
  - Screenshot captured to `docs/verification-evidence/mcp-inspector-local.png`
- **Claude Code session live test**:
  1. Register in `~/.claude/mcp.json`
  2. Restart Claude Code
  3. `/mcp` lists `universal-skills` with 3 tools
  4. Inside a fresh session: "find a skill for PDF processing" → resolve-skill invoked → returns results
  5. Transcript logged to `docs/verification-evidence/claude-session-$(date +%Y%m%d).log`
- **Codex session live test**:
  1. Register server per Spike S4 confirmed format in `~/.codex/config.toml`
  2. Restart Codex
  3. Tools appear in session; invoke resolve-skill; returns results
  4. Transcript logged to `docs/verification-evidence/codex-session-$(date +%Y%m%d).log`

### Tier 3 — End-to-end (Phase 3 acceptance gate)

Runs after Phase 3 workers deploy to production. Captures live evidence.

```bash
# 1. Bridge catalogs
curl -s https://registry.marketplace.blazesportsintel.com/.claude-plugin/marketplace.json | jq '.plugins | length'
# Expected: >= 10 (prompt line 150)

curl -s https://registry.marketplace.blazesportsintel.com/.agents/plugins/marketplace.json | jq '.plugins | length'
# Expected: >= 10 (prompt lines 60-62)

# 2. Health
curl -s https://api.marketplace.blazesportsintel.com/health | jq
# Expected: {"status":"ok","d1":"up","r2":"up","version":"0.1.0",...}

curl -s https://marketplace.blazesportsintel.com/health | jq
# Same

# 3. MCP tool invocation — resolve-skill
curl -X POST https://api.marketplace.blazesportsintel.com/mcp \
  -H "content-type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "resolve-skill",
      "arguments": { "query": "pdf", "limit": 5 }
    }
  }' | jq '.result.content[0].text | fromjson | .results | length'
# Expected: >= 3

# 4. MCP tools/list
curl -X POST https://api.marketplace.blazesportsintel.com/mcp \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools | length'
# Expected: 3

# 5. Rate limiting works
for i in {1..70}; do
  curl -s -o /dev/null -w "%{http_code} " https://api.marketplace.blazesportsintel.com/mcp -X POST -d '{"jsonrpc":"2.0","method":"tools/list","id":1}' -H "content-type: application/json"
done
# Expected: first 60 = 200, remainder = 429 with Retry-After

# 6. npm package smoke test on clean machine
docker run --rm node:20-alpine sh -c "npx -y @blazesportsintel/universal-skills-mcp --help"
# Expected: prints help text, exits 0

# 7. Indexer cron evidence
wrangler tail universal-skills-indexer --format=pretty | head -100
# Expected: shows cron invocations + UPSERT logs every 6h
```

All outputs recorded to `docs/verification-evidence/e2e-$(date +%Y%m%d).log`.

## Phase acceptance gates (from the plan)

### Phase 0 acceptance
- [ ] All 9 upstream URLs verified (Spike S1) — **DONE** per `docs/spikes/upstream-availability.md`
- [ ] Codex plugin.json schema derived from 16 real plugins (Spike S2) — **DONE** per `docs/spikes/codex-schema-drift.md` + `schema/codex-plugin.schema.json`
- [ ] GitHub rate-limit budget confirmed (Spike S3) — **DONE** per `docs/spikes/github-rate-limits.md`
- [ ] Codex MCP client parity documented (Spike S4) — **DONE** per `docs/spikes/mcp-client-parity.md` (awaits live confirmation in P2-9)
- [ ] DNS setup documented for Austin (Spike S5) — **DONE** per `docs/spikes/dns-setup.md`
- [ ] agentskills.io provenance researched (Spike S6) — **DONE** per `docs/spikes/agentskills-provenance.md`
- [ ] iCloud build strategy documented (Spike S7) — **DONE** per `docs/spikes/icloud-build-strategy.md`

### Phase 1 acceptance
- [ ] `packages/schema/` zod + JSON Schemas for all 5 manifest formats + canonical
- [ ] `schema/d1-schema.sql` validates in local SQLite with FTS5 working
- [ ] `skills/universal-skills-marketplace/SKILL.md` passes `validate.sh` (≤100 lines, valid frontmatter)
- [ ] All 12 reference files present, cross-links valid
- [ ] All 7 script files executable and passing self-tests
- [ ] Assets directory populated with schemas, templates, real-examples, fixtures
- [ ] Skill packages as `.skill` bundle without error
- [ ] `skill-creator:skill-reviewer` agent rates the skill ≥ "complete" on every dimension

### Phase 2 acceptance
- [ ] `@blazesportsintel/universal-skills-mcp` scaffolded with SDK + zod + vitest
- [ ] All 3 tools (resolve/get/install) implemented with typed zod I/O
- [ ] All 3 transports (stdio/http/sse) implemented
- [ ] Translator round-trip passes on all 31+ fixtures
- [ ] Scorer satisfies prompt-line-147 invariant
- [ ] MCP Inspector handshake succeeds
- [ ] Live in both Claude Code AND Codex sessions (evidence logged)
- [ ] `npm publish --tag alpha` succeeds; clean-machine `npx` smoke test passes

### Phase 3 acceptance
- [ ] D1 provisioned + schema applied
- [ ] R2 bucket created
- [ ] KV namespaces × 3 created
- [ ] 3 Workers deployed + custom domains bound
- [ ] Indexer cron populates D1 with ≥50 skills across ≥5 source repos (first run)
- [ ] API Worker: `POST /mcp tools/list` returns 3 tools
- [ ] Bridge Worker: both marketplace.json endpoints return ≥10 plugins
- [ ] `GET /health` returns OK on all 3 Workers
- [ ] `@blazesportsintel/universal-skills-mcp` switched to `HttpRegistry` backend; live session still works

### Continuous (production)

- [ ] Indexer cron runs every 6h without errors for 7 consecutive days before declaring GA
- [ ] `registry.marketplace.blazesportsintel.com` uptime ≥99.9% per Cloudflare Workers SLA
- [ ] Zero `translation_log.level === "error"` entries in production stream for any plugin from the 9 upstream repos

## Evidence format

Every tier-2 and tier-3 test writes evidence to `docs/verification-evidence/` with filename `<test-name>-<yyyymmdd>.log`:

```
docs/verification-evidence/
├── mcp-inspector-local-20260415.png        # Phase 2 P2-8
├── claude-session-resolve-pdf-20260418.log # Phase 2 P2-9
├── codex-session-resolve-pdf-20260418.log  # Phase 2 P2-9
├── e2e-20260420.log                        # Phase 3 P3-6
├── curl-marketplace-json-20260420.txt      # Phase 3 P3-4
└── curl-mcp-tools-list-20260420.txt        # Phase 3 P3-3
```

Keep these in the repo (commit them) — they're the audit trail that proves acceptance was met.

## Reporting

When reporting completion to Austin, use the BSI reporting standard:

- **WRONG:** "All tests pass. Deployed to production."
- **RIGHT:** "The marketplace now returns 18 skills across Claude and Codex ecosystems. `resolve-skill('pdf')` from a fresh Claude Code session returns 5 results in 180ms. Codex session confirmed via test transcript in `docs/verification-evidence/codex-session-...log`."

## See also

- [plan file](../../../../../.claude/plans/zesty-growing-flurry.md) — full phase schedule
- [`scripts/validate.sh`](../scripts/validate.sh) — self-check implementation (authored Phase 1-P1-3d)
- [`scripts/test-translator.ts`](../scripts/test-translator.ts) — round-trip runner
- [`09-quality-scoring-rubric.md`](09-quality-scoring-rubric.md) — scoring assertions
- [`11-manifest-translator-algorithm.md`](11-manifest-translator-algorithm.md) — round-trip invariants
