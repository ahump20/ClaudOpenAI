/**
 * POST /mcp — JSON-RPC 2.0 MCP handler.
 * Dispatches tools/list and tools/call to the resolve/content/install handlers.
 */
import type { Env } from "../index.js";
import { handleResolveSkill } from "./resolve.js";
import { handleGetSkillContent } from "./content.js";
import { handleInstallSkill } from "./install.js";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: unknown;
  method: string;
  params?: {
    name?: string;
    arguments?: unknown;
  };
}

const TOOL_DEFS = [
  {
    name: "resolve-skill",
    description:
      "Search the ClaudOpenAI universal skills marketplace for skills matching a natural-language query. Returns ranked results with quality scores and install commands for both Claude Code and OpenAI Codex.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1 },
        ecosystem: { type: "string", enum: ["claude", "codex", "universal", "any"], default: "any" },
        category: { type: "string" },
        min_quality: { type: "integer", minimum: 0, maximum: 100, default: 30 },
        source_repo: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
      },
      required: ["query"],
    },
  },
  {
    name: "get-skill-content",
    description: "Fetch full content of a specific skill with progressive disclosure.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        include: {
          type: "array",
          items: { type: "string", enum: ["metadata", "body", "references", "scripts", "assets", "canonical_json"] },
        },
        version: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "install-skill",
    description:
      "Emit install command (default) or write skill directly to disk. Auto-detects target ecosystem.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        target: { type: "string", enum: ["claude", "codex", "auto-detect"], default: "auto-detect" },
        mode: { type: "string", enum: ["command-only", "write-to-disk"], default: "command-only" },
        scope: { type: "string", enum: ["user", "project"], default: "user" },
      },
      required: ["id"],
    },
  },
];

export async function handleMcp(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  let body: JsonRpcRequest;
  try {
    body = (await req.json()) as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, "Parse error");
  }

  if (body.jsonrpc !== "2.0" || !body.method) {
    return rpcError(body.id, -32600, "Invalid Request");
  }

  try {
    switch (body.method) {
      case "tools/list":
        return rpcResult(body.id, { tools: TOOL_DEFS });

      case "tools/call": {
        const { name, arguments: args } = body.params ?? {};
        switch (name) {
          case "resolve-skill": {
            const result = await handleResolveSkill(env, args);
            return rpcResult(body.id, {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            });
          }
          case "get-skill-content": {
            const result = await handleGetSkillContent(env, args);
            return rpcResult(body.id, {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            });
          }
          case "install-skill": {
            const result = await handleInstallSkill(env, args);
            return rpcResult(body.id, {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            });
          }
          default:
            return rpcError(body.id, -32601, `Unknown tool: ${name ?? "(missing name)"}`);
        }
      }

      default:
        return rpcError(body.id, -32601, `Unknown method: ${body.method}`);
    }
  } catch (err) {
    console.error("mcp handler error:", err);
    return rpcError(
      body.id,
      -32603,
      err instanceof Error ? err.message : "Internal error",
    );
  }
}

function rpcResult(id: unknown, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    },
  });
}

function rpcError(id: unknown, code: number, message: string): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }),
    {
      status: code >= -32099 && code <= -32000 ? 500 : 400,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      },
    },
  );
}
