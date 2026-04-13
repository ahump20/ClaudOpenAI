/**
 * resolve-skill — Pattern B search tool.
 * See references/04-mcp-tool-design.md.
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Registry } from "../lib/registry.js";

export const ResolveSkillInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(500)
    .describe(
      "Natural-language query. Examples: 'PDF processing', 'Stripe webhook validation', 'React component scaffolding'.",
    ),
  ecosystem: z
    .enum(["claude", "codex", "universal", "any"])
    .default("any")
    .describe(
      "Filter by source ecosystem. 'universal' = works in both without translation. 'any' = no filter.",
    ),
  category: z.string().optional().describe("Filter by Codex-style category (Coding, Productivity, ...)."),
  min_quality: z
    .number()
    .int()
    .min(0)
    .max(100)
    .default(30)
    .describe("Minimum quality score 0-100. Default 30 excludes stubs."),
  source_repo: z
    .string()
    .optional()
    .describe("Filter by upstream repo, e.g. 'anthropics/skills' or 'openai/plugins'."),
  limit: z.number().int().min(1).max(50).default(10),
});

export type ResolveSkillInput = z.infer<typeof ResolveSkillInputSchema>;

export const RESOLVE_SKILL_TOOL_DEF = {
  name: "resolve-skill",
  description:
    "Search the ClaudOpenAI universal skills marketplace for skills matching a natural-language query. Returns ranked results with quality scores and install commands for BOTH Claude Code and OpenAI Codex. Use when the user asks to 'find a skill for X', 'search for skills', or wants to discover capabilities across both ecosystems.",
  inputSchema: zodToJsonSchema(ResolveSkillInputSchema),
} as const;

export async function handleResolveSkill(
  registry: Registry,
  args: unknown,
): Promise<Record<string, unknown>> {
  const input = ResolveSkillInputSchema.parse(args);
  const startedAt = Date.now();
  const results = await registry.resolveSkills(input);
  const elapsed = Date.now() - startedAt;
  return {
    results,
    meta: {
      source: "universal-skills-marketplace",
      fetched_at: new Date().toISOString(),
      timezone: "America/Chicago",
      registry_version: "0.1.0",
      cache_hit: false,
      query_time_ms: elapsed,
      result_count: results.length,
    },
  };
}
