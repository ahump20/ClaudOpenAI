/**
 * resolve-skill handler (Phase 3 — D1-backed via BM25 FTS5).
 */
import type { Env } from "../index.js";
import { cacheKey } from "../lib/cache.js";

interface ResolveArgs {
  query: string;
  ecosystem?: "claude" | "codex" | "universal" | "any";
  category?: string;
  min_quality?: number;
  source_repo?: string;
  limit?: number;
}

interface SkillRow {
  id: string;
  name: string;
  description: string;
  source_ecosystem: "claude" | "codex" | "universal";
  source_url: string;
  source_repo: string;
  quality_score: number;
  content_hash: string;
  compat_claude: number;
  compat_codex: number;
}

export async function handleResolveSkill(env: Env, args: unknown): Promise<Record<string, unknown>> {
  const input = validateArgs(args);
  const startedAt = Date.now();

  // Try cache first
  const key = cacheKey("resolve", input as unknown as Record<string, unknown>);
  const cached = await env.CACHE.get(key, "json");
  if (cached) {
    return {
      ...(cached as object),
      meta: { ...(cached as { meta: Record<string, unknown> }).meta, cache_hit: true },
    };
  }

  // Build SQL with optional filters
  const clauses: string[] = [
    "skills_fts MATCH ?",
    "s.tombstoned = 0",
    "s.quality_score >= ?",
  ];
  const bindings: unknown[] = [input.query, input.min_quality];

  if (input.ecosystem && input.ecosystem !== "any") {
    clauses.push("s.source_ecosystem = ?");
    bindings.push(input.ecosystem);
  }
  if (input.source_repo) {
    clauses.push("s.source_repo = ?");
    bindings.push(input.source_repo);
  }
  if (input.category) {
    clauses.push("s.category = ?");
    bindings.push(input.category);
  }

  const sql = `
    SELECT s.id, s.name, s.description, s.source_ecosystem, s.source_url, s.source_repo,
           s.quality_score, s.content_hash, s.compat_claude, s.compat_codex,
           bm25(skills_fts) AS rank
    FROM skills s
    JOIN skills_fts fts ON s.rowid = fts.rowid
    WHERE ${clauses.join(" AND ")}
    ORDER BY rank + ((100 - s.quality_score) / 50.0)
    LIMIT ?
  `;
  bindings.push(input.limit);

  const { results } = await env.DB.prepare(sql)
    .bind(...bindings)
    .all<SkillRow & { rank: number }>();

  const formatted = results.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    quality_score: r.quality_score,
    source_ecosystem: r.source_ecosystem,
    source_url: r.source_url,
    source_repo: r.source_repo,
    compatibility: {
      claude: r.compat_claude === 1,
      codex: r.compat_codex === 1,
    },
    install_commands: {
      claude: `/plugin marketplace add ${r.source_repo} && /plugin install ${r.name}@${r.source_repo.replace("/", "-")}`,
      codex: `$skill-installer install ${r.source_repo}/${r.name}`,
    },
    content_hash: r.content_hash,
  }));

  const response = {
    results: formatted,
    meta: {
      source: "universal-skills-marketplace",
      fetched_at: new Date().toISOString(),
      timezone: "America/Chicago",
      registry_version: env.REGISTRY_VERSION,
      cache_hit: false,
      query_time_ms: Date.now() - startedAt,
      result_count: formatted.length,
    },
  };

  await env.CACHE.put(key, JSON.stringify(response), { expirationTtl: 600 });
  return response;
}

function validateArgs(args: unknown): Required<ResolveArgs> {
  if (!args || typeof args !== "object") throw new Error("Missing arguments");
  const a = args as Partial<ResolveArgs>;
  if (!a.query || typeof a.query !== "string") {
    throw new Error("'query' is required (string)");
  }
  return {
    query: a.query,
    ecosystem: a.ecosystem ?? "any",
    category: a.category ?? "",
    min_quality: typeof a.min_quality === "number" ? a.min_quality : 30,
    source_repo: a.source_repo ?? "",
    limit: typeof a.limit === "number" ? Math.min(50, Math.max(1, a.limit)) : 10,
  };
}
