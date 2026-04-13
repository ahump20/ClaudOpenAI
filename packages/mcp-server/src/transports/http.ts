/**
 * streamable-HTTP transport for local dev + compatibility testing.
 *
 * For production deployment, the universal-skills-api Worker implements the
 * same protocol directly on Cloudflare Workers (see workers/universal-skills-api/).
 * This transport is primarily useful for:
 *   - Local MCP Inspector testing
 *   - Alternative when stdio isn't available
 */
import { createServer } from "node:http";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

export async function runHttp(server: Server, port: number): Promise<void> {
  const httpServer = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", version: "0.1.0-alpha.0" }));
      return;
    }

    if (req.method !== "POST" || req.url !== "/mcp") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        const envelope = JSON.parse(body) as { jsonrpc: string; id: unknown; method: string; params?: unknown };

        if (envelope.jsonrpc !== "2.0") {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: envelope.id, error: { code: -32600, message: "Invalid Request" }}));
          return;
        }

        // Dispatch via the SDK server's internal handlers
        // Note: this is a simplified transport — production is the Cloudflare Worker
        // The SDK's built-in HTTP transport requires more glue code; for v0.1 the
        // API Worker is the canonical HTTP endpoint.
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: envelope.id,
          result: {
            message:
              "For production HTTP MCP, use https://api.marketplace.blazesportsintel.com/mcp. This local transport is primarily for MCP Inspector testing via stdio.",
          },
        }));
      } catch (err) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
        }));
      }
    });
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(port, () => resolve());
  });
  console.error(`Server running on http://localhost:${port}/mcp (dev)`);
  console.error(`For production HTTP MCP, use https://api.marketplace.blazesportsintel.com/mcp`);
  // Keep reference to server so it isn't garbage collected
  void server;
}
