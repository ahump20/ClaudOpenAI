/**
 * Claude plugin manifest zod schema.
 * Convention-based — plugin.json is minimal; directory walking drives everything.
 * See references/02-claude-plugin-format.md.
 */
import { z } from "zod";

export const ClaudePluginAuthorSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  url: z.string().optional(),
}).passthrough();

export const ClaudePluginSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  description: z.string(),
  author: ClaudePluginAuthorSchema.optional(),
}).passthrough();

export type ClaudePlugin = z.infer<typeof ClaudePluginSchema>;

// Flat .mcp.json shape (Claude)
export const ClaudeMcpJsonSchema = z.record(
  z.object({
    type: z.enum(["http", "stdio", "sse", "streamable_http"]).optional(),
    url: z.string().optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
  }).passthrough(),
);

export type ClaudeMcpJson = z.infer<typeof ClaudeMcpJsonSchema>;

// hooks/hooks.json shape (shared with Codex — see codex.ts)
export const ClaudeHooksJsonSchema = z.object({
  description: z.string().optional(),
  hooks: z.record(
    z.array(
      z.object({
        matcher: z.string().optional(),
        hooks: z.array(
          z.object({
            type: z.literal("command"),
            command: z.string(),
            timeout: z.number().optional(),
          }),
        ),
      }),
    ),
  ),
});

export type ClaudeHooksJson = z.infer<typeof ClaudeHooksJsonSchema>;
