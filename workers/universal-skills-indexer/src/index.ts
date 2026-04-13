/**
 * universal-skills-indexer — cron-triggered indexer Worker.
 *
 * Runs every 6h (cron "0 */6 * * *"). Fetches SKILL.md + plugin.json files from
 * the 9 upstream sources, normalizes via the translator, scores, and UPSERTs to D1 + R2.
 *
 * See references/08-github-indexer-design.md for the full algorithm.
 */
import { SOURCES, type UpstreamSource } from "./sources.js";
import { GithubClient } from "./lib/github-client.js";
import { normalizeFile } from "./lib/normalize.js";
import { upsertSkill } from "./lib/upsert.js";

export interface Env {
  DB: D1Database;
  CONTENT: R2Bucket;
  INDEXER_STATE: KVNamespace;
  GITHUB_TOKEN: string;
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runIndexCycle(env));
  },

  // Manual trigger for debugging: POST /run (no auth in v0.1 — protect via Cloudflare Access later)
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          status: "ok",
          timezone: "America/Chicago",
          fetched_at: new Date().toISOString(),
          sources_count: SOURCES.length,
        }),
        { headers: { "content-type": "application/json" } },
      );
    }

    if (req.method === "POST" && url.pathname === "/run") {
      ctx.waitUntil(runIndexCycle(env));
      return new Response(JSON.stringify({ started: true }), {
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function runIndexCycle(env: Env): Promise<void> {
  const cycleStart = Date.now();
  const results = { ok: 0, unchanged: 0, errors: 0, skipped_ratelimit: 0, total_skills_upserted: 0 };

  const github = new GithubClient(env.GITHUB_TOKEN);

  for (const src of SOURCES) {
    try {
      const outcome = await indexSource(src, github, env);
      results[outcome.status as keyof typeof results]++;
      if (outcome.upserted) results.total_skills_upserted += outcome.upserted;
    } catch (err) {
      if (err && typeof err === "object" && "name" in err && err.name === "RateLimitExceeded") {
        console.warn(`[indexer] rate-limited on ${src.name}; will resume next cycle`);
        results.skipped_ratelimit++;
        break; // stop the cycle; next cron run will pick up where we left off
      }
      console.error(`[indexer] ${src.name}:`, err);
      results.errors++;
      await env.INDEXER_STATE.put(`error:${src.name}`, err instanceof Error ? err.message : String(err), {
        expirationTtl: 86400,
      });
    }

    // Cooperative yield — avoid secondary rate limits
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const duration = Date.now() - cycleStart;
  console.log(
    `[indexer] cycle done in ${duration}ms: ${JSON.stringify(results)} (rate-limit remaining: core=${github.lastCore}, search=${github.lastSearch})`,
  );

  // Record cycle stats
  await env.INDEXER_STATE.put(
    "last_cycle",
    JSON.stringify({
      cycle_at: new Date().toISOString(),
      duration_ms: duration,
      ...results,
      core_remaining: github.lastCore,
      search_remaining: github.lastSearch,
    }),
    { expirationTtl: 7 * 86400 },
  );
}

async function indexSource(
  src: UpstreamSource,
  github: GithubClient,
  env: Env,
): Promise<{ status: "ok" | "unchanged" | "errors"; upserted?: number }> {
  const headSha = await github.getHeadSha(src.name);
  const lastSha = await env.INDEXER_STATE.get(`sha:${src.name}`);

  if (headSha === lastSha) {
    await env.INDEXER_STATE.put(`last_checked:${src.name}`, new Date().toISOString(), {
      expirationTtl: 7 * 86400,
    });
    return { status: "unchanged" };
  }

  const files = await github.listRelevantFiles(src.name, headSha, src.paths);
  let upserted = 0;

  for (const file of files) {
    try {
      const content = await github.getFileContent(src.name, file.path, headSha);
      const canonical = await normalizeFile(src, file.path, content, headSha);
      if (!canonical) continue;

      const changed = await upsertSkill(env.DB, env.CONTENT, canonical);
      if (changed) upserted++;
    } catch (err) {
      console.warn(`[indexer] skip ${src.name}:${file.path} —`, err);
    }
  }

  await env.INDEXER_STATE.put(`sha:${src.name}`, headSha, { expirationTtl: 30 * 86400 });

  return { status: "ok", upserted };
}
