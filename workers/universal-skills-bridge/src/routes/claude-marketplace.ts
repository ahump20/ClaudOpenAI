import type { Env } from "../index.js";

interface Row {
  id: string;
  name: string;
  description: string;
  source_url: string;
  source_repo: string;
  source_commit: string;
  quality_score: number;
}

export async function renderClaudeMarketplace(env: Env): Promise<Record<string, unknown>> {
  const { results } = await env.DB.prepare(
    `SELECT id, name, description, source_url, source_repo, source_commit, quality_score
     FROM skills
     WHERE tombstoned = 0
       AND manifest_format IN ('claude-plugin', 'standalone-skill')
       AND quality_score >= 30
     ORDER BY quality_score DESC, name
     LIMIT 500`,
  ).all<Row>();

  return {
    $schema:
      "https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/schemas/marketplace.schema.json",
    name: "ClaudOpenAI Universal Skills",
    description:
      "Unofficial cross-ecosystem skills marketplace. Indexes anthropics/skills, anthropics/claude-plugins-official, anthropics/knowledge-work-plugins plus cross-platform skills from openai/skills that are compatible with Claude Code. Not affiliated with Anthropic.",
    owner: {
      name: "Austin Humphrey / Blaze Sports Intel",
      url: "https://blazesportsintel.com",
      email: "ahump20@outlook.com",
    },
    plugins: results.map((row) => ({
      name: row.name,
      description: row.description,
      source: {
        source: "git-subdir",
        url: `https://github.com/${row.source_repo}`,
        ref: row.source_commit,
      },
      quality_score: row.quality_score,
      source_url: row.source_url,
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
