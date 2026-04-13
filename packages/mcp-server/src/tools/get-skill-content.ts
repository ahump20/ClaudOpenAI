/**
 * get-skill-content — progressive-disclosure fetch tool.
 * Clients specify which parts to fetch; metadata is always cheap.
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Registry } from "../lib/registry.js";

export const GetSkillContentInputSchema = z.object({
  id: z
    .string()
    .describe(
      "Skill ID as returned by resolve-skill. Format: '{source}/{name}' e.g. 'anthropics-skills/pdf'.",
    ),
  include: z
    .array(
      z.enum(["metadata", "body", "references", "scripts", "assets", "canonical_json"]),
    )
    .default(["metadata", "body"])
    .describe(
      "Which parts to return. 'metadata' is always cheap; 'references' can be heavy. Request only what you need.",
    ),
  version: z.string().optional().describe("Specific version; defaults to latest."),
});

export type GetSkillContentInput = z.infer<typeof GetSkillContentInputSchema>;

export const GET_SKILL_CONTENT_TOOL_DEF = {
  name: "get-skill-content",
  description:
    "Fetch the full content of a specific skill by ID (as returned by resolve-skill). Supports progressive disclosure: fetch just metadata, or pull references/scripts/assets as needed. Use when you need to inspect a skill's SKILL.md body or reference files before installing.",
  inputSchema: zodToJsonSchema(GetSkillContentInputSchema),
} as const;

export async function handleGetSkillContent(
  registry: Registry,
  args: unknown,
): Promise<Record<string, unknown>> {
  const input = GetSkillContentInputSchema.parse(args);
  const content = await registry.getSkillContent(input.id, input.include, input.version);
  return {
    ...content,
    meta: {
      source: "universal-skills-marketplace",
      fetched_at: new Date().toISOString(),
      timezone: "America/Chicago",
    },
  };
}
