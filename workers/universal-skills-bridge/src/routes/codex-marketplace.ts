import type { Env } from "../index.js";

interface Row {
  id: string;
  name: string;
  description: string;
  source_url: string;
  source_repo: string;
  source_commit: string;
  quality_score: number;
  category: string | null;
}

export async function renderCodexMarketplace(env: Env): Promise<Record<string, unknown>> {
  const { results } = await env.DB.prepare(
    `SELECT id, name, description, source_url, source_repo, source_commit, quality_score, category
     FROM skills
     WHERE tombstoned = 0
       AND manifest_format IN ('codex-plugin', 'standalone-skill')
       AND quality_score >= 30
     ORDER BY quality_score DESC, name
     LIMIT 500`,
  ).all<Row>();

  return {
    name: "ClaudOpenAI Universal Skills",
    description:
      "Unofficial cross-ecosystem skills marketplace. Indexes openai/skills, openai/plugins, openai/codex-plugin-cc plus cross-platform skills from anthropics repos. Not affiliated with OpenAI.",
    owner: {
      name: "Austin Humphrey / Blaze Sports Intel",
      url: "https://blazesportsintel.com",
      email: "ahump20@outlook.com",
    },
    plugins: results.map((row) => ({
      name: row.name,
      description: row.description,
      source: row.source_url,
      source_repo: row.source_repo,
      source_commit: row.source_commit,
      category: row.category ?? "Coding",
      quality_score: row.quality_score,
    })),
    meta: {
      source: "universal-skills-marketplace",
      fetched_at: new Date().toISOString(),
      timezone: "America/Chicago",
      registry_version: env.REGISTRY_VERSION,
      plugin_count: results.length,
    },
  };
}
