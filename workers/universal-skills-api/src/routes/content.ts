/**
 * get-skill-content handler (Phase 3 — reads D1 metadata, presigns R2 URLs).
 */
import type { Env } from "../index.js";

interface ContentArgs {
  id: string;
  include?: Array<"metadata" | "body" | "references" | "scripts" | "assets" | "canonical_json">;
  version?: string;
}

export async function handleGetSkillContent(env: Env, args: unknown): Promise<Record<string, unknown>> {
  const input = validateArgs(args);

  const skill = await env.DB.prepare(
    "SELECT id, name, description, source_url, quality_score, content_hash FROM skills WHERE id = ? AND tombstoned = 0",
  )
    .bind(input.id)
    .first<{
      id: string;
      name: string;
      description: string;
      source_url: string;
      quality_score: number;
      content_hash: string;
    } | null>();

  if (!skill) {
    return {
      error: "skill_not_found",
      id: input.id,
      meta: {
        source: "universal-skills-marketplace",
        fetched_at: new Date().toISOString(),
        timezone: "America/Chicago",
      },
    };
  }

  const versionResult = await env.DB.prepare(
    "SELECT version FROM skill_versions WHERE skill_id = ? ORDER BY indexed_at DESC LIMIT 1",
  )
    .bind(skill.id)
    .first<{ version: string } | null>();
  const version = input.version ?? versionResult?.version ?? "latest";

  const result: Record<string, unknown> = {
    id: skill.id,
    version,
    meta: {
      source: "universal-skills-marketplace",
      fetched_at: new Date().toISOString(),
      timezone: "America/Chicago",
    },
  };

  if (input.include.includes("metadata")) {
    result.metadata = {
      name: skill.name,
      description: skill.description,
      source_url: skill.source_url,
      quality_score: skill.quality_score,
    };
  }

  if (input.include.includes("body")) {
    const r2Object = await env.CONTENT.get(`skills/${skill.id}/${version}/skill.md`);
    if (r2Object) {
      result.body = await r2Object.text();
    }
  }

  if (input.include.includes("canonical_json")) {
    const r2Object = await env.CONTENT.get(`skills/${skill.id}/${version}/canonical.json`);
    if (r2Object) {
      result.canonical_json = await r2Object.json();
    }
  }

  return result;
}

function validateArgs(args: unknown): Required<ContentArgs> {
  if (!args || typeof args !== "object") throw new Error("Missing arguments");
  const a = args as Partial<ContentArgs>;
  if (!a.id || typeof a.id !== "string") throw new Error("'id' is required (string)");
  return {
    id: a.id,
    include: a.include ?? ["metadata", "body"],
    version: a.version ?? "",
  };
}
