# 08 — GitHub Indexer Design

The cron-driven `universal-skills-indexer` Worker. Pulls SKILL.md + plugin.json files from the 9 verified upstream repos (per [`docs/spikes/upstream-availability.md`](../../../docs/spikes/upstream-availability.md)), normalizes them via the translator, scores them, and UPSERTs into D1 + R2.

## Strategy: clone-and-walk, not search

Per [Spike S3 GitHub rate limits](../../../docs/spikes/github-rate-limits.md), GitHub Code Search is capped at 30 rpm authenticated. We can't reliably index 280K+ skills that way. Instead:

1. `git ls-remote` → free, no API quota
2. If HEAD changed → sparse-clone → walk local FS → free CDN bandwidth
3. Pull file contents via Contents API (`/repos/{owner}/{name}/contents/{path}`) **only when** we need full content and the file's sha mismatches what's in D1

This keeps the core REST API hot path to ~10-50 calls per cycle. Well under the 5000 rph budget.

## Upstream source definitions

```ts
// workers/universal-skills-indexer/src/lib/sources.ts
export const SOURCES: UpstreamSource[] = [
  { name: "anthropics/claude-plugins-official", tier: "B", poll_interval_seconds: 21600,
    paths: ["plugins/", "external_plugins/"], manifest_hint: "claude-plugin" },
  { name: "anthropics/skills", tier: "B", poll_interval_seconds: 21600,
    paths: ["skills/"], manifest_hint: "standalone-skill" },
  { name: "anthropics/knowledge-work-plugins", tier: "A", poll_interval_seconds: 21600,
    paths: ["plugins/"], manifest_hint: "claude-plugin" },
  { name: "openai/codex", tier: "A", poll_interval_seconds: 21600,
    paths: ["plugins/"], manifest_hint: "codex-plugin" },
  { name: "openai/codex-plugin-cc", tier: "A", poll_interval_seconds: 21600,
    paths: ["."], manifest_hint: "codex-plugin" },
  { name: "openai/skills", tier: "B", poll_interval_seconds: 21600,
    paths: [".system/", ".curated/", ".experimental/"], manifest_hint: "standalone-skill" },
  { name: "openai/swarm", tier: "C", poll_interval_seconds: 86400, // dormant
    paths: ["examples/"], manifest_hint: "openai-agent" },          // note: not a skill
  { name: "openai/openai-agents-python", tier: "A", poll_interval_seconds: 21600,
    paths: ["examples/"], manifest_hint: "openai-agent" },
  { name: "openai/plugins", tier: "B", poll_interval_seconds: 21600,
    paths: ["."], manifest_hint: "codex-plugin" },
];

export interface UpstreamSource {
  name: string;                           // "owner/repo"
  tier: "A" | "B" | "C";
  poll_interval_seconds: number;
  paths: string[];                        // relative to repo root
  manifest_hint: "claude-plugin" | "codex-plugin" | "standalone-skill" | "openai-agent";
}
```

`manifest_hint` tells the normalizer what shape to expect so parsing is fast + correct.

## Cycle algorithm

```ts
// workers/universal-skills-indexer/src/index.ts
async function runIndexCycle(env: Env) {
  const cycleStart = Date.now();
  const results = { ok: 0, unchanged: 0, errors: 0, skipped_ratelimit: 0 };

  for (const src of SOURCES) {
    const shouldPoll = await shouldPollSource(env, src);
    if (!shouldPoll) {
      continue;
    }

    try {
      const result = await indexSource(env, src);
      results[result.status]++;
      await updateSourceState(env, src, result);
    } catch (err) {
      console.error(`[indexer] ${src.name}: ${err.message}`);
      results.errors++;
      await updateSourceState(env, src, { status: "error", error_message: err.message });
    }

    // Cooperate with rate limits — yield briefly
    await sleep(500);
  }

  console.log(`[indexer] cycle done in ${Date.now() - cycleStart}ms: ${JSON.stringify(results)}`);
}
```

## Per-source indexSource flow

```ts
async function indexSource(env: Env, src: UpstreamSource): Promise<IndexResult> {
  // 1. Get current HEAD SHA of default branch
  const headSha = await fetchRepoHead(env, src.name);

  // 2. Compare to last-indexed SHA (stored in KV)
  const lastSha = await env.INDEXER_STATE.get(`sha:${src.name}`);

  if (headSha === lastSha) {
    return { status: "unchanged", headSha };
  }

  // 3. List changed paths between lastSha and headSha
  // (fallback: list all tracked paths if no lastSha — first run)
  const changedPaths = lastSha
    ? await diffPaths(env, src.name, lastSha, headSha)
    : await listAllPaths(env, src.name, headSha, src.paths);

  // 4. Filter to SKILL.md + plugin.json files
  const relevant = changedPaths.filter(p =>
    p.endsWith("/SKILL.md") ||
    p.endsWith("/.claude-plugin/plugin.json") ||
    p.endsWith("/.codex-plugin/plugin.json") ||
    p.endsWith("/.claude-plugin/marketplace.json") ||
    p.endsWith("/.agents/plugins/marketplace.json")
  );

  // 5. Process each file
  let upserted = 0;
  for (const path of relevant) {
    const content = await fetchContent(env, src.name, path, headSha);
    const canonical = await normalize(src, path, content);
    const hash = await sha256(JSON.stringify(canonical));

    const result = await upsertSkill(env.DB, canonical, hash);
    if (result.changed) {
      await uploadSkillContent(env, canonical);
      upserted++;
    }
  }

  // 6. Record new HEAD SHA
  await env.INDEXER_STATE.put(`sha:${src.name}`, headSha);

  return { status: "ok", headSha, upserted };
}
```

## GitHub API helpers

### Fetch repo HEAD

```ts
async function fetchRepoHead(env: Env, repo: string): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: { "authorization": `Bearer ${env.GITHUB_TOKEN}`, "user-agent": "universal-skills-indexer" },
  });
  trackRateLimit(res);
  const data = await res.json<{ default_branch: string }>();

  const branchRes = await fetch(`https://api.github.com/repos/${repo}/branches/${data.default_branch}`, {
    headers: { "authorization": `Bearer ${env.GITHUB_TOKEN}`, "user-agent": "universal-skills-indexer" },
  });
  trackRateLimit(branchRes);
  const branch = await branchRes.json<{ commit: { sha: string }}>();
  return branch.commit.sha;
}
```

### Diff paths between two SHAs

```ts
async function diffPaths(env: Env, repo: string, base: string, head: string): Promise<string[]> {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/compare/${base}...${head}`,
    {
      headers: { "authorization": `Bearer ${env.GITHUB_TOKEN}`, "user-agent": "universal-skills-indexer" },
    }
  );
  trackRateLimit(res);
  const data = await res.json<{ files: Array<{ filename: string; status: string }> }>();
  return data.files
    .filter(f => f.status !== "removed")
    .map(f => f.filename);
}
```

### List all tracked paths (first run only)

```ts
async function listAllPaths(env: Env, repo: string, sha: string, subdirs: string[]): Promise<string[]> {
  // Use tree API with recursive=true (one call returns ALL paths)
  const res = await fetch(
    `https://api.github.com/repos/${repo}/git/trees/${sha}?recursive=1`,
    {
      headers: { "authorization": `Bearer ${env.GITHUB_TOKEN}`, "user-agent": "universal-skills-indexer" },
    }
  );
  trackRateLimit(res);
  const data = await res.json<{ tree: Array<{ path: string; type: string }>; truncated: boolean }>();
  if (data.truncated) {
    // Very large repo — fall back to sparse-clone (unmetered)
    return await sparseCloneListFiles(repo, sha, subdirs);
  }
  return data.tree
    .filter(e => e.type === "blob")
    .filter(e => subdirs.some(d => e.path.startsWith(d) || d === "."))
    .map(e => e.path);
}
```

### Fetch file content

```ts
async function fetchContent(env: Env, repo: string, path: string, sha: string): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/contents/${path}?ref=${sha}`,
    {
      headers: { "authorization": `Bearer ${env.GITHUB_TOKEN}`, "user-agent": "universal-skills-indexer" },
    }
  );
  trackRateLimit(res);
  const data = await res.json<{ content: string; encoding: "base64" }>();
  // GitHub returns base64-encoded file content
  return atob(data.content.replace(/\n/g, ""));
}
```

## Rate-limit tracking

```ts
function trackRateLimit(res: Response): void {
  const remaining = Number(res.headers.get("x-ratelimit-remaining"));
  const reset = Number(res.headers.get("x-ratelimit-reset"));

  if (!Number.isNaN(remaining)) {
    console.log(`[rate-limit] remaining=${remaining} reset=${new Date(reset * 1000).toISOString()}`);
    // Persist to KV for observability endpoint
  }

  if (remaining < 100) {
    console.warn(`[rate-limit] WARNING: only ${remaining} requests remaining`);
  }

  if (res.status === 429 || res.status === 403) {
    const retryAfter = Number(res.headers.get("retry-after") || reset - Date.now() / 1000);
    throw new RateLimitExceededError(retryAfter);
  }
}
```

When `RateLimitExceededError` bubbles, the cycle checkpoints the last good state to KV and returns. Next cycle resumes.

## Normalization path

```ts
async function normalize(src: UpstreamSource, path: string, content: string): Promise<CanonicalSkill> {
  // Dispatch by manifest_hint
  if (path.endsWith("/plugin.json")) {
    // Determine claude vs codex from path
    if (path.includes("/.claude-plugin/")) {
      const manifest = JSON.parse(content);
      return toCanonical(manifest, "claude");
    } else if (path.includes("/.codex-plugin/")) {
      const manifest = JSON.parse(content);
      return toCanonical(manifest, "codex");
    }
  }

  if (path.endsWith("/SKILL.md")) {
    const { frontmatter, body } = parseFrontmatter(content);
    return toCanonical({ frontmatter, body, path }, "standalone");
  }

  if (path.endsWith("/marketplace.json")) {
    // Marketplace catalog — don't normalize, just index for bridge
    return toMarketplaceRecord(JSON.parse(content), src);
  }

  throw new Error(`No normalizer for ${path}`);
}
```

## Scoring

After normalization, score 0-100 per [`09-quality-scoring-rubric.md`](09-quality-scoring-rubric.md):

```ts
canonical.quality_score = scoreSkill(canonical);
```

## First-run bootstrap

First cycle against a new source: `listAllPaths` returns thousands of paths. Rate-limit budget matters.

Strategy for large repos (>500 files):
1. Process top-level SKILL.md + plugin.json files first (quality metadata cheap)
2. Defer content fetches for skills where metadata already indicates low quality (score < 30)
3. Spread across 2-3 cycles if needed (state in KV `bootstrap:<source>:cursor`)

## Observability (post-MVP)

`indexer.marketplace.blazesportsintel.com/_admin/stats` (gated by `X-Admin-Key`):

```json
{
  "last_cycle_at": "2026-04-12T18:00:00Z",
  "last_cycle_duration_ms": 45000,
  "sources": [
    { "name": "anthropics/skills", "last_sync_sha": "abc...", "last_sync_at": "...", "last_result": "ok", "skills_indexed": 123 },
    ...
  ],
  "github_rate_limit": { "remaining": 4800, "reset": "..." }
}
```

## Failure modes

| Failure | Handling |
|---------|----------|
| GitHub rate limit | Checkpoint, return, resume next cycle |
| GitHub 404 on a path | Log + skip that path (may have been deleted); don't fail the whole cycle |
| Manifest parse error | Record in `sources.error_message`; skip; alert if recurring |
| D1 write fails | Retry 3× with exponential backoff; if still fails, log + abort cycle |
| R2 write fails | Skip R2 upload (D1 metadata still updated); log; will retry next cycle when `content_hash` still mismatches |
| Worker CPU time exceeded | Cycle's cooperative yield (`await sleep(500)`) prevents this; if it still happens, split by source |

## Manual cycle trigger

```bash
curl -X POST https://indexer.marketplace.blazesportsintel.com/run \
  -H "X-Admin-Key: $ADMIN_KEY"
```

Useful for: after adding a new source, after fixing a parser bug, debugging.

## Testing

```ts
// workers/universal-skills-indexer/tests/normalize.test.ts
describe("normalize", () => {
  it("converts real canva plugin.json to canonical", async () => {
    const content = await readFixture("codex/canva/plugin.json");
    const canonical = await normalize({ name: "openai/plugins", manifest_hint: "codex-plugin", ... }, "plugins/canva/.codex-plugin/plugin.json", content);
    expect(canonical.origin.ecosystem).toBe("codex");
    expect(canonical.interface?.category).toBe("Productivity");
    expect(canonical.skills).toHaveLength(3);
  });
});
```

Fixtures under `skills/universal-skills-marketplace/assets/fixtures/` are the source of truth; tests reference them relatively.

## See also

- [`docs/spikes/github-rate-limits.md`](../../../docs/spikes/github-rate-limits.md) — budget math
- [`docs/spikes/upstream-availability.md`](../../../docs/spikes/upstream-availability.md) — source tier assignments
- [`06-d1-schema-design.md`](06-d1-schema-design.md) — UPSERT patterns + delta detection
- [`07-r2-storage-patterns.md`](07-r2-storage-patterns.md) — content upload flow
- [`11-manifest-translator-algorithm.md`](11-manifest-translator-algorithm.md) — the `toCanonical` used by the indexer
- [`09-quality-scoring-rubric.md`](09-quality-scoring-rubric.md) — score assignment
