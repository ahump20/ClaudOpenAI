/**
 * universal-skills-bridge — dynamic marketplace.json emitter.
 *
 * Routes:
 *   GET /.claude-plugin/marketplace.json     Claude Code format
 *   GET /.agents/plugins/marketplace.json    OpenAI Codex format
 *   GET /.well-known/universal-skills.json   federated discovery (stub in v0.1)
 *   GET /health
 *   GET /                                     HTML landing page
 */
import { renderClaudeMarketplace } from "./routes/claude-marketplace.js";
import { renderCodexMarketplace } from "./routes/codex-marketplace.js";
import { renderLandingPage } from "./routes/landing.js";

export interface Env {
  DB: D1Database;
  REGISTRY_VERSION: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    try {
      if (req.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, OPTIONS",
            "access-control-max-age": "86400",
          },
        });
      }

      if (req.method !== "GET") {
        return json({ error: "method_not_allowed" }, 405);
      }

      if (url.pathname === "/health") {
        return json({
          status: "ok",
          version: env.REGISTRY_VERSION,
          timezone: "America/Chicago",
          fetched_at: new Date().toISOString(),
        });
      }

      if (url.pathname === "/.claude-plugin/marketplace.json") {
        return json(await renderClaudeMarketplace(env), 200, {
          "cache-control": "public, max-age=300",
        });
      }

      if (url.pathname === "/.agents/plugins/marketplace.json") {
        return json(await renderCodexMarketplace(env), 200, {
          "cache-control": "public, max-age=300",
        });
      }

      if (url.pathname === "/.well-known/universal-skills.json") {
        return json({
          schema: "https://marketplace.blazesportsintel.com/schemas/well-known.json",
          name: "ClaudOpenAI Universal Skills Marketplace",
          description:
            "Unofficial cross-ecosystem skills marketplace. Not affiliated with Anthropic or OpenAI.",
          claude_marketplace: "/.claude-plugin/marketplace.json",
          codex_marketplace: "/.agents/plugins/marketplace.json",
          mcp_endpoint: "https://api.marketplace.blazesportsintel.com/mcp",
          version: env.REGISTRY_VERSION,
          sources_indexed: 9,
          repository: "https://github.com/ahump20/ClaudOpenAI",
          license: "Apache-2.0",
          fetched_at: new Date().toISOString(),
        });
      }

      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(await renderLandingPage(env), {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "public, max-age=300",
          },
        });
      }

      return json({ error: "not_found", path: url.pathname }, 404);
    } catch (err) {
      console.error("bridge fatal:", err);
      return json(
        { error: "internal_server_error", message: err instanceof Error ? err.message : "unknown" },
        500,
      );
    }
  },
} satisfies ExportedHandler<Env>;

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      ...extraHeaders,
    },
  });
}
