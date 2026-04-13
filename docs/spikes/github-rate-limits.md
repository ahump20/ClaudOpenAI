# Spike S3 — GitHub API Rate Limits & Indexer Budget

**Question:** Can the indexer keep pace with 8 upstream repos on a 6-hour cron without starving out?

## The quotas (canonical, docs.github.com)

| Endpoint class | Unauthenticated | Authenticated (PAT) | GitHub App install |
|----------------|-----------------|---------------------|--------------------|
| Core REST API (`GET /repos/...`, `GET /contents/...`) | 60 req/hour | **5,000 req/hour** | 15,000 req/hour |
| Code Search (`/search/code?q=...`) | **not available** | **30 req/minute** (1,800 req/hour) | 30 req/min |
| Secondary rate limits (heuristic) | CPU-time enforced | CPU-time enforced | CPU-time enforced |

Conditional requests (ETag / `If-None-Match` → 304 Not Modified) **do not consume quota**. This is the foundational trick.

## Indexer budget (per 6-hour cron cycle)

**Strategy — clone-and-walk instead of search API (per Plan Risk R3):**

For each of the 8 (now 9, inc. `openai/plugins`) upstream repos:
1. `git ls-remote --heads {repo}` — free, no quota
2. If `HEAD SHA` != stored `last_sync_sha` in D1:
   - `git clone --depth=1 --filter=blob:none --sparse {repo} /tmp/upstream/{slug}` — uses GitHub contents CDN, no REST quota
   - `git sparse-checkout set skills/ plugins/ .codex-plugin/ .claude-plugin/ SKILL.md`
3. Walk filesystem locally — free
4. For each changed SKILL.md, produce canonical record, UPSERT D1

**Quota use per cycle:** 9 `ls-remote` calls (free) + up to 9 sparse clones per cycle. Clones touch the CDN, not the API.

**Fallback (search-based delta index for repos we don't fully clone):**
- 9 upstream repos × 1 Code Search per repo (`filename:SKILL.md in:path repo:{owner}/{name}`) = 9 calls
- Each returns paginated results (100 per page max)
- Budget: 30 req/min authenticated = 1800 req/hour = **sufficient even for 1000-page results**

## Required: authenticated token

Unauthenticated (60 req/hr core, 0 req/min search) is **not viable**. The indexer Worker secret `GITHUB_TOKEN` must be set before first run:

```bash
wrangler secret put GITHUB_TOKEN --config workers/universal-skills-indexer/wrangler.toml
```

Use a fine-grained PAT with:
- Repository access: **public repositories (read-only)** — sufficient; all 9 upstreams are public
- Permissions: `contents: read`, `metadata: read`
- Expiration: 1 year, rotated before

Token already on file in Austin's private `CLAUDE.md` global config. Copy into Worker secret via `wrangler secret put GITHUB_TOKEN` — never commit to this repo.

## Observability

Track `x-ratelimit-remaining` and `x-ratelimit-reset` headers in every response. Log to KV `INDEXER_STATE:ratelimit` per-cycle. If remaining < 500 at end of cycle, alert (email/Discord hook TBD).

## Secondary-rate-limit defense

GitHub has a second hidden budget based on CPU time (not documented precisely, but well-known from community reports):
- Keep concurrent requests ≤ 10
- Throttle to ≤ 5 req/sec per endpoint
- Honor `retry-after` header on 429 responses

Implementation: single Worker fetch loop with `p-limit(5)`-style concurrency cap, exponential backoff on 429, `retry-after` respected.

## Math check

Worst-case cycle assumptions:
- All 9 repos changed since last sync
- Each repo has 100 SKILL.md files
- Each file changed → 1 content fetch

Total fetches per cycle: 9 × 100 = 900 content fetches. At 5,000/hour authenticated, this uses **18% of hourly quota**. Plenty of headroom for retries and spike days.

## Conclusion

Go. Authenticated token required; clone-and-walk is primary strategy; search API fallback for coverage; observability from day 1.
