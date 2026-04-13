/**
 * Canonical intermediate format. The translator operates:
 *   Claude ↔ Canonical ↔ Codex ↔ Standalone.
 *
 * See references/11-manifest-translator-algorithm.md for the full specification.
 */
import { z } from "zod";

export const TranslationLogEntrySchema = z.object({
  level: z.enum(["info", "warning", "lossy", "error"]),
  field: z.string(),
  message: z.string(),
  shim_generated: z.string().nullable().default(null),
});

export const AuthorSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  url: z.string().optional(),
}).passthrough();

export const OriginSchema = z.object({
  ecosystem: z.enum(["claude", "codex", "standalone"]),
  sourcePath: z.string(),
  sourceSha: z.string().nullable().default(null),
  repo: z.string().nullable().default(null),
  discoveredAt: z.string().datetime().optional(),
});

export const AgentSchema = z.object({
  name: z.string(),
  description: z.string().nullable().default(null),
  tools: z.array(z.string()).default([]),
  model: z.string().nullable().default(null),
  color: z.string().nullable().default(null),
  body: z.string(),
  scope: z.enum(["plugin", "skill"]).default("plugin"),
  parentSkill: z.string().nullable().default(null),
});

export const SkillContentSchema = z.object({
  path: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string().nullable().default(null),
  frontmatter: z.record(z.unknown()).default({}),
  body: z.string().default(""),
  references: z.array(z.string()).default([]),
  scripts: z.array(z.string()).default([]),
  assets: z.array(z.string()).default([]),
  nestedAgents: z.array(AgentSchema).default([]),
  skillInterface: z.record(z.unknown()).nullable().default(null),
});

export const CommandSchema = z.object({
  name: z.string(),
  description: z.string().nullable().default(null),
  argumentHint: z.string().nullable().default(null),
  allowedTools: z.array(z.string()).default([]),
  body: z.string(),
});

export const HookEventSchema = z.object({
  matcher: z.string().nullable().default(null),
  hooks: z.array(z.object({
    type: z.literal("command"),
    command: z.string(),
    timeout: z.number().nullable().default(null),
  })),
});

export const HooksSchema = z.object({
  description: z.string().nullable().default(null),
  events: z.record(z.array(HookEventSchema)),
});

export const McpServerEntrySchema = z.object({
  type: z.enum(["http", "stdio", "sse", "streamable_http"]).optional(),
  url: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});

export const CompatibilityFlagsSchema = z.object({
  compatible: z.boolean(),
  min_version: z.string().nullable().default(null),
  lossy_fields: z.array(z.string()).default([]),
});

export const CanonicalSkillSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)?$/),
  origin: OriginSchema,
  type: z.enum(["plugin", "skill", "marketplace"]),
  name: z.string(),
  description: z.string(),
  version: z.string().nullable().default(null),
  author: AuthorSchema.nullable().default(null),
  homepage: z.string().nullable().default(null),
  repository: z.string().nullable().default(null),
  license: z.string().nullable().default(null),
  keywords: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  category: z.string().nullable().default(null),
  skills: z.array(SkillContentSchema).default([]),
  mcpServers: z.record(McpServerEntrySchema).default({}),
  commands: z.array(CommandSchema).default([]),
  hooks: HooksSchema.nullable().default(null),
  agents: z.array(AgentSchema).default([]),
  apps: z.record(z.unknown()).default({}),
  interface: z.record(z.unknown()).nullable().default(null),
  ecosystem_extensions: z.object({
    claude: z.record(z.unknown()).default({}),
    codex: z.record(z.unknown()).default({}),
  }).default({ claude: {}, codex: {} }),
  translation_log: z.array(TranslationLogEntrySchema).default([]),
  quality_score: z.number().min(0).max(100).default(0),
  quality_breakdown: z.record(z.number()).default({}),
  compatibility_flags: z.object({
    claude: CompatibilityFlagsSchema.optional(),
    codex: CompatibilityFlagsSchema.optional(),
  }).default({}),
  content_hash: z.string().default(""),
  last_verified: z.string().default(""),
  install_count: z.number().int().min(0).default(0),
});

export type CanonicalSkill = z.infer<typeof CanonicalSkillSchema>;
export type TranslationLogEntry = z.infer<typeof TranslationLogEntrySchema>;
export type Author = z.infer<typeof AuthorSchema>;
export type Origin = z.infer<typeof OriginSchema>;
export type SkillContent = z.infer<typeof SkillContentSchema>;
export type Agent = z.infer<typeof AgentSchema>;
export type Command = z.infer<typeof CommandSchema>;
export type Hooks = z.infer<typeof HooksSchema>;
export type McpServerEntry = z.infer<typeof McpServerEntrySchema>;
