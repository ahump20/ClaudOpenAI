#!/usr/bin/env node
/**
 * @blazesportsintel/universal-skills-mcp — CLI entry.
 *
 * Usage:
 *   universal-skills-mcp                             # stdio transport (default)
 *   universal-skills-mcp --transport stdio
 *   universal-skills-mcp --transport http --port 3007
 *
 * Environment:
 *   GITHUB_TOKEN              (optional) lifts GitHub API rate limits 60rph→5000rph
 *   UNIVERSAL_SKILLS_REGISTRY (optional) URL of HttpRegistry backend (defaults to GitHubRegistry)
 */

import { parseArgs } from "node:util";
import { createServerInstance } from "./server.js";
import { runStdio } from "./transports/stdio.js";
import { runHttp } from "./transports/http.js";

interface CliArgs {
  transport: "stdio" | "http";
  port: number;
  registry?: string;
  help: boolean;
}

function parseCliArgs(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv.slice(2),
    options: {
      transport: { type: "string", default: "stdio" },
      port: { type: "string", default: "3007" },
      registry: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: false,
  });

  const transport = values.transport as string;
  if (transport !== "stdio" && transport !== "http") {
    throw new Error(`Invalid --transport: ${transport}. Expected stdio | http.`);
  }

  return {
    transport: transport as "stdio" | "http",
    port: Number.parseInt(values.port as string, 10),
    registry: values.registry as string | undefined,
    help: values.help as boolean,
  };
}

function printHelp(): void {
  process.stdout.write(`universal-skills-mcp — Context7-pattern skills marketplace MCP server.

Usage:
  universal-skills-mcp [options]

Options:
  --transport <stdio|http>   Transport to use (default: stdio)
  --port <number>            HTTP port when --transport=http (default: 3007)
  --registry <url>           HttpRegistry backend URL (default: built-in GitHubRegistry)
  -h, --help                 Show this message

Environment:
  GITHUB_TOKEN               GitHub PAT (optional; lifts rate limits)
  UNIVERSAL_SKILLS_REGISTRY  HttpRegistry URL override

Project: https://github.com/ahump20/ClaudOpenAI
License: Apache-2.0 (Unofficial — not affiliated with Anthropic or OpenAI)
`);
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const server = createServerInstance({
    githubToken: process.env.GITHUB_TOKEN,
    registryUrl: args.registry ?? process.env.UNIVERSAL_SKILLS_REGISTRY,
  });

  if (args.transport === "http") {
    await runHttp(server, args.port);
  } else {
    await runStdio(server);
  }
}

main().catch((err) => {
  console.error("universal-skills-mcp fatal:", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
