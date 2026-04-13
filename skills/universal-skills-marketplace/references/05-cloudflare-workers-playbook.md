# 05 — Cloudflare Workers Playbook

Deployment recipe for the three Workers in `workers/`. Cross-links Anthropic's canonical [`building-mcp-server-on-cloudflare`](file:///Users/AustinHumphrey/.claude/plugins/marketplaces/cloudflare/) skill and Austin's own reference implementation at `BSI-repo/workers/college-baseball-mcp/`.

## Why Workers

Per `build-mcp-server` SKILL.md Phase 2 recommendation: "fastest deploy path (Workers-native scaffold) ... zero to live URL in two commands."

Our workloads fit:
- **api** — HTTP MCP serving stateless tool calls, low latency < 200ms budget
- **indexer** — scheduled cron with D1/R2 writes
- **bridge** — read-only catalog emission with D1 queries

All three are stateless request-handlers or scheduled jobs. No long-running processes. Perfect Workers fit.

## Repository layout

```
workers/
├── universal-skills-api/
│   ├── src/
│   │   ├── index.ts             # fetch() handler, JSON-RPC 2.0 routing
│   │   ├── routes/
│   │   │   ├── mcp.ts           # POST /mcp
│   │   │   ├── resolve.ts       # inner resolve-skill implementation
│   │   │   ├── content.ts       # inner get-skill-content
│   │   │   ├── install.ts       # inner install-skill
│   │   │   └── health.ts        # GET /health
│   │   └── lib/
│   │       ├── d1.ts            # D1 query helpers
│   │       ├── r2.ts            # presigned URL generation
│   │       └── rate-limit.ts    # KV-backed rate limiter
│   ├── wrangler.toml
│   ├── package.json
│   ├── tsconfig.json
│   └── tests/
├── universal-skills-indexer/
│   ├── src/
│   │   ├── index.ts             # scheduled() handler
│   │   └── lib/
│   │       ├── github-client.ts
│   │       ├── sources.ts       # 9 upstream repo definitions
│   │       ├── clone-walk.ts    # sparse-clone + filesystem walk
│   │       ├── normalize.ts     # → canonical via @blazesportsintel/universal-skills-schema
│   │       └── scorer.ts        # shared with npm package
│   ├── wrangler.toml
│   └── ...
└── universal-skills-bridge/
    ├── src/
    │   ├── index.ts
    │   ├── routes/
    │   │   ├── claude-marketplace.ts    # GET /.claude-plugin/marketplace.json
    │   │   ├── codex-marketplace.ts     # GET /.agents/plugins/marketplace.json
    │   │   ├── well-known.ts            # GET /.well-known/universal-skills.json
    │   │   └── health.ts
    │   └── lib/
    │       ├── d1.ts
    │       ├── render-claude.ts
    │       └── render-codex.ts
    ├── wrangler.toml
    └── ...
```

Each worker has its own `wrangler.toml` + `package.json` + `tsconfig.json`. Npm workspaces resolve shared deps (`@blazesportsintel/universal-skills-schema`).

## `wrangler.toml` per Worker

### api

```toml
name = "universal-skills-api"
main = "src/index.ts"
compatibility_date = "2026-04-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "universal-skills"
database_id = "<from wrangler d1 create>"

[[r2_buckets]]
binding = "CONTENT"
bucket_name = "universal-skills-content"

[[kv_namespaces]]
binding = "CACHE"
id = "<from wrangler kv:namespace create>"

[[kv_namespaces]]
binding = "RATE_LIMIT"
id = "<from wrangler kv:namespace create>"

[observability]
enabled = true

[[routes]]
pattern = "api.marketplace.blazesportsintel.com/*"
zone_name = "blazesportsintel.com"
custom_domain = true

[vars]
REGISTRY_VERSION = "0.1.0"
```

### indexer

```toml
name = "universal-skills-indexer"
main = "src/index.ts"
compatibility_date = "2026-04-01"
compatibility_flags = ["nodejs_compat"]

[triggers]
crons = ["0 */6 * * *"]      # every 6 hours

[[d1_databases]]
binding = "DB"
database_name = "universal-skills"
database_id = "<same as api>"

[[r2_buckets]]
binding = "CONTENT"
bucket_name = "universal-skills-content"

[[kv_namespaces]]
binding = "INDEXER_STATE"
id = "<from wrangler kv:namespace create>"

[observability]
enabled = true

# No routes — internal only, cron-driven
```

Secret: `GITHUB_TOKEN` via `wrangler secret put GITHUB_TOKEN --config workers/universal-skills-indexer/wrangler.toml`.

### bridge

```toml
name = "universal-skills-bridge"
main = "src/index.ts"
compatibility_date = "2026-04-01"

[[d1_databases]]
binding = "DB"
database_name = "universal-skills"
database_id = "<same>"

[observability]
enabled = true

[[routes]]
pattern = "marketplace.blazesportsintel.com/*"
zone_name = "blazesportsintel.com"
custom_domain = true

[[routes]]
pattern = "registry.marketplace.blazesportsintel.com/*"
zone_name = "blazesportsintel.com"
custom_domain = true
```

## The 5-command provision sequence

```bash
# 1. D1
wrangler d1 create universal-skills
wrangler d1 execute universal-skills --file=schema/d1-schema.sql

# 2. R2
wrangler r2 bucket create universal-skills-content

# 3. KV × 3
wrangler kv:namespace create CACHE
wrangler kv:namespace create RATE_LIMIT
wrangler kv:namespace create INDEXER_STATE

# 4. Secrets
wrangler secret put GITHUB_TOKEN --config workers/universal-skills-indexer/wrangler.toml

# 5. Deploy all three
npm run deploy:all
```

## Handler pattern — api worker

```ts
// workers/universal-skills-api/src/index.ts
import { handleMcp } from "./routes/mcp";
import { handleHealth } from "./routes/health";
import { rateLimit } from "./lib/rate-limit";

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
      // Health check bypasses rate limit
      if (url.pathname === "/health") {
        return handleHealth(env);
      }

      // Rate limit
      const rl = await rateLimit(req, env.RATE_LIMIT, { rpm: 60 });
      if (!rl.ok) {
        return new Response(JSON.stringify({ error: "rate_limited", retry_after: rl.retryAfter }), {
          status: 429,
          headers: { "Retry-After": String(rl.retryAfter), "content-type": "application/json" }
        });
      }

      // MCP endpoint
      if (url.pathname === "/mcp" && req.method === "POST") {
        return handleMcp(req, env, ctx);
      }

      return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    } catch (err) {
      console.error(err);
      return new Response(JSON.stringify({
        error: "internal_server_error",
        message: err instanceof Error ? err.message : "unknown"
      }), { status: 500, headers: { "content-type": "application/json" }});
    }
  }
};
```

## JSON-RPC 2.0 MCP handler shape

```ts
// workers/universal-skills-api/src/routes/mcp.ts
export async function handleMcp(req: Request, env: Env, ctx: ExecutionContext) {
  const body = await req.json();

  // Validate JSON-RPC 2.0 envelope
  if (body.jsonrpc !== "2.0" || !body.method) {
    return rpcError(-32600, "Invalid Request", body.id);
  }

  switch (body.method) {
    case "tools/list":
      return rpcResult({
        tools: [RESOLVE_SKILL_TOOL_DEF, GET_SKILL_CONTENT_TOOL_DEF, INSTALL_SKILL_TOOL_DEF]
      }, body.id);

    case "tools/call":
      const { name, arguments: args } = body.params || {};
      switch (name) {
        case "resolve-skill":
          return rpcResult({ content: [{ type: "text", text: JSON.stringify(await handleResolveSkill(args, env)) }] }, body.id);
        case "get-skill-content":
          return rpcResult({ content: [{ type: "text", text: JSON.stringify(await handleGetSkillContent(args, env)) }] }, body.id);
        case "install-skill":
          return rpcResult({ content: [{ type: "text", text: JSON.stringify(await handleInstallSkill(args, env)) }] }, body.id);
        default:
          return rpcError(-32601, `Unknown tool: ${name}`, body.id);
      }

    default:
      return rpcError(-32601, `Unknown method: ${body.method}`, body.id);
  }
}

function rpcResult(result: unknown, id: unknown) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: { "content-type": "application/json" }
  });
}

function rpcError(code: number, message: string, id: unknown) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message }}), {
    headers: { "content-type": "application/json" }
  });
}
```

This mirrors the pattern in `BSI-repo/workers/college-baseball-mcp/src/worker.ts`. Fork it when writing ours.

## Streamable HTTP transport

Per MCP spec 2025-06-18, streamable-HTTP allows servers to send SSE events as tool results. For v0.1 we ship **non-streaming** responses (single JSON object in Response body). Upgrade path: add `content-type: text/event-stream` branch when tools/call yields chunks.

## Scheduled (cron) handler pattern — indexer worker

```ts
// workers/universal-skills-indexer/src/index.ts
export interface Env {
  DB: D1Database;
  CONTENT: R2Bucket;
  INDEXER_STATE: KVNamespace;
  GITHUB_TOKEN: string;
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runIndexCycle(env));
  },

  // Also support manual run via fetch (for dev)
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response(JSON.stringify({ status: "ok" }));
    if (url.pathname === "/run" && req.method === "POST") {
      ctx.waitUntil(runIndexCycle(env));
      return new Response(JSON.stringify({ started: true }));
    }
    return new Response("not found", { status: 404 });
  }
};

async function runIndexCycle(env: Env): Promise<void> {
  const sources = await listSources(env);
  for (const src of sources) {
    try {
      const headSha = await getRepoHead(src, env.GITHUB_TOKEN);
      const lastSyncSha = await env.INDEXER_STATE.get(`sha:${src.name}`);
      if (headSha === lastSyncSha) {
        await env.INDEXER_STATE.put(`last_checked:${src.name}`, new Date().toISOString());
        continue;
      }

      const files = await sparseClone(src, headSha, env.GITHUB_TOKEN);
      for (const file of files) {
        const canonical = await normalize(file);
        const hash = sha256(JSON.stringify(canonical));
        await upsertSkill(env.DB, canonical, hash);
        if (file.content) {
          await env.CONTENT.put(`skills/${canonical.id}/${canonical.version}/skill.md`, file.content);
        }
      }

      await env.INDEXER_STATE.put(`sha:${src.name}`, headSha);
    } catch (err) {
      console.error(`Indexer failed for ${src.name}:`, err);
      // Continue with next source
    }
  }
}
```

See [`08-github-indexer-design.md`](08-github-indexer-design.md) for the full sparse-clone strategy + rate-limit math.

## Local dev with `wrangler dev`

```bash
# API worker
wrangler dev --config workers/universal-skills-api/wrangler.toml --local

# Indexer — trigger cron manually
wrangler dev --config workers/universal-skills-indexer/wrangler.toml --test-scheduled --local

# Bridge
wrangler dev --config workers/universal-skills-bridge/wrangler.toml --local
```

`--local` uses miniflare (simulated Workers runtime). D1/R2/KV bindings use local SQLite/filesystem/in-memory — no cloud API calls during dev.

## Tests with miniflare

```ts
// workers/universal-skills-api/tests/health.test.ts
import { describe, it, expect } from "vitest";
import worker from "../src/index";
import { createD1, createR2, createKV } from "miniflare";

describe("health endpoint", () => {
  it("returns 200 with status ok", async () => {
    const env = { DB: createD1(":memory:"), CONTENT: createR2(), CACHE: createKV(), RATE_LIMIT: createKV(), REGISTRY_VERSION: "test" };
    const req = new Request("https://api/health");
    const res = await worker.fetch(req, env as any, {} as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
  });
});
```

## Observability

`[observability] enabled = true` in every wrangler.toml turns on Workers logs + analytics. Tail a running worker:

```bash
wrangler tail universal-skills-api
wrangler tail universal-skills-indexer  # see cron runs
```

Cloudflare dashboard → Workers → Analytics for request counts, error rates, P50/P99 latencies.

## Deployment ceremony

```bash
npm run deploy:api          # deploy api
npm run deploy:bridge       # deploy bridge
npm run deploy:indexer      # deploy indexer (cron picks up)
npm run deploy:all          # all three in sequence
```

Bound to git tag via `.github/workflows/deploy-workers.yml` (Phase 4).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `wrangler deploy` hangs > 5min | iCloud FileProvider backpressure | See [`docs/spikes/icloud-build-strategy.md`](../../../docs/spikes/icloud-build-strategy.md); move build to `/var/tmp/` |
| `D1_ERROR: Binding DB not found` | `wrangler.toml` missing `[[d1_databases]]` | Re-run `wrangler d1 list` to get real ID; paste into toml |
| `429 Too Many Requests` from GitHub | Indexer running without `GITHUB_TOKEN` secret | `wrangler secret put GITHUB_TOKEN ...` |
| MCP Inspector handshake fails | Response missing `jsonrpc: "2.0"` envelope | Check `rpcResult`/`rpcError` helpers; ensure `content-type: application/json` |
| Custom domain shows 1016 DNS error | CNAME not yet propagated or worker not bound | Wait 1-3 minutes; check `wrangler dev` logs for route match |

## See also

- [`building-mcp-server-on-cloudflare`](file:///Users/AustinHumphrey/.claude/plugins/marketplaces/cloudflare/) — Anthropic's canonical Cloudflare-specific MCP guide
- `BSI-repo/workers/college-baseball-mcp/src/worker.ts` — working reference implementation
- [`06-d1-schema-design.md`](06-d1-schema-design.md) — D1 schema for `DB` binding
- [`07-r2-storage-patterns.md`](07-r2-storage-patterns.md) — R2 key structure for `CONTENT` binding
- [`08-github-indexer-design.md`](08-github-indexer-design.md) — indexer's full algorithm
