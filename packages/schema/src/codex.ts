/**
 * Codex plugin manifest zod schema. Derived from 16 installed openai-curated plugins
 * at ~/.codex/plugins/cache/openai-curated/ (Spike S2).
 * See references/03-codex-plugin-format.md + docs/spikes/codex-schema-drift.md.
 */
import { z } from "zod";

export const CodexAuthorSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  url: z.string().optional(),
});

export const CodexInterfaceSchema = z.object({
  displayName: z.string(),
  shortDescription: z.string(),
  longDescription: z.string(),
  developerName: z.string().optional(),
  category: z.string(),
  capabilities: z.array(z.string()),
  websiteURL: z.string(),
  privacyPolicyURL: z.string(),
  termsOfServiceURL: z.string(),
  defaultPrompt: z.union([z.string(), z.array(z.string())]),
  composerIcon: z.string(),
  logo: z.string(),
  screenshots: z.array(z.unknown()),
  brandColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
}).passthrough();

export const CodexPluginSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  version: z.string(),
  description: z.string(),
  author: CodexAuthorSchema,
  homepage: z.string(),
  repository: z.string(),
  license: z.string(),
  keywords: z.array(z.string()),
  skills: z.string().regex(/^\.\//),
  interface: CodexInterfaceSchema,
  apps: z.string().regex(/^\.\//).optional(),
  mcpServers: z.string().regex(/^\.\//).optional(),
  hooks: z.string().regex(/^\.\//).optional(),
}).passthrough();

export type CodexPlugin = z.infer<typeof CodexPluginSchema>;
export type CodexInterface = z.infer<typeof CodexInterfaceSchema>;

// Wrapped .mcp.json shape (Codex)
export const CodexMcpJsonSchema = z.object({
  mcpServers: z.record(
    z.object({
      type: z.enum(["http", "stdio", "sse", "streamable_http"]).optional(),
      url: z.string().optional(),
      command: z.string().optional(),
      args: z.array(z.string()).optional(),
      env: z.record(z.string()).optional(),
    }).passthrough(),
  ),
});

export type CodexMcpJson = z.infer<typeof CodexMcpJsonSchema>;

// .app.json shape
export const CodexAppJsonSchema = z.object({
  apps: z.record(
    z.object({
      id: z.string(),
    }),
  ),
});

export type CodexAppJson = z.infer<typeof CodexAppJsonSchema>;
