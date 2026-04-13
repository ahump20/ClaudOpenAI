/**
 * createServerInstance — factory that returns a configured MCP server.
 * Stateless per-request for HTTP; stateful per-session for stdio.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { GitHubClient } from "./lib/github-client.js";
import { GitHubRegistry, HttpRegistry, type Registry } from "./lib/registry.js";
import {
  RESOLVE_SKILL_TOOL_DEF,
  handleResolveSkill,
} from "./tools/resolve-skill.js";
import {
  GET_SKILL_CONTENT_TOOL_DEF,
  handleGetSkillContent,
} from "./tools/get-skill-content.js";
import {
  INSTALL_SKILL_TOOL_DEF,
  handleInstallSkill,
} from "./tools/install-skill.js";
import { UniversalSkillsError } from "./errors.js";

export interface ServerOptions {
  githubToken?: string;
  registryUrl?: string;
  registry?: Registry;
}

export function createServerInstance(options: ServerOptions = {}): Server {
  const registry =
    options.registry ??
    (options.registryUrl
      ? new HttpRegistry(options.registryUrl)
      : new GitHubRegistry(new GitHubClient({ token: options.githubToken })));

  const server = new Server(
    { name: "universal-skills-marketplace", version: "0.1.0-alpha.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [RESOLVE_SKILL_TOOL_DEF, GET_SKILL_CONTENT_TOOL_DEF, INSTALL_SKILL_TOOL_DEF],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      let result: Record<string, unknown>;
      switch (name) {
        case "resolve-skill":
          result = await handleResolveSkill(registry, args);
          break;
        case "get-skill-content":
          result = await handleGetSkillContent(registry, args);
          break;
        case "install-skill":
          result = await handleInstallSkill(registry, args);
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const errorPayload =
        err instanceof UniversalSkillsError
          ? err.toJSON()
          : { error: "internal_error", message: err instanceof Error ? err.message : String(err) };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(errorPayload, null, 2) }],
        isError: true,
      };
    }
  });

  return server;
}
