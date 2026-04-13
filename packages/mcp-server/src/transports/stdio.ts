/**
 * stdio transport — default, used by npx invocation.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

export async function runStdio(server: Server): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // MCP servers log to stderr so stdout stays reserved for the JSON-RPC channel
  console.error("Server running on stdio");
}
