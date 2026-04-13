/**
 * universal-skills-api — HTTP MCP transport Worker.
 *
 * Routes:
 *   POST /mcp              JSON-RPC 2.0 MCP endpoint
 *   GET  /health           health check
 *
 * Bindings:
 *   DB           D1 database (universal-skills)
 *   CONTENT      R2 bucket (universal-skills-content)
 *   CACHE        KV (query result cache)
 *   RATE_LIMIT   KV (per-IP rate limiting)
 */
import { handleMcp } from "./routes/mcp.js";
import { handleHealth } from "./routes/health.js";
import { rateLimit } from "./lib/rate-limit.js";

export interface Env {
  DB: D1Database;
  CONTENT: R2Bucket;
  CACHE: KVNamespace;
  RATE_LIMIT: KVNamespace;
  REGISTRY_VERSION: string;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return handleHealth(env);
      }

      // CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "POST, GET, OPTIONS",
            "access-control-allow-headers": "content-type",
            "access-control-max-age": "86400",
          },
        });
      }

      // Rate-limit all non-health routes
      const rl = await rateLimit(req, env.RATE_LIMIT, { rpm: 60 });
      if (!rl.ok) {
        return json(
          {
            error: "rate_limited",
            message: `Too many requests. Retry after ${rl.retryAfter}s.`,
            retry_after_seconds: rl.retryAfter,
          },
          429,
          { "retry-after": String(rl.retryAfter) },
        );
      }

      if (req.method === "POST" && url.pathname === "/mcp") {
        return handleMcp(req, env, ctx);
      }

      return json({ error: "not_found", message: `${req.method} ${url.pathname}` }, 404);
    } catch (err) {
      console.error("api fatal:", err);
      return json(
        {
          error: "internal_server_error",
          message: err instanceof Error ? err.message : "unknown",
        },
        500,
      );
    }
  },
} satisfies ExportedHandler<Env>;

function json(body: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      ...extraHeaders,
    },
  });
}
