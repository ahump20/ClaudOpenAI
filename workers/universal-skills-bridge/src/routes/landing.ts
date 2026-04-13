import type { Env } from "../index.js";

export async function renderLandingPage(env: Env): Promise<string> {
  // Pull a few stats from D1 for the landing
  let totalCount = 0;
  let claudeCount = 0;
  let codexCount = 0;
  try {
    const stats = await env.DB.prepare(
      `SELECT
         COUNT(*) FILTER (WHERE tombstoned = 0) AS total,
         COUNT(*) FILTER (WHERE tombstoned = 0 AND source_ecosystem = 'claude') AS claude,
         COUNT(*) FILTER (WHERE tombstoned = 0 AND source_ecosystem = 'codex') AS codex
       FROM skills`,
    ).first<{ total: number; claude: number; codex: number }>();
    if (stats) {
      totalCount = stats.total ?? 0;
      claudeCount = stats.claude ?? 0;
      codexCount = stats.codex ?? 0;
    }
  } catch {
    // D1 not provisioned yet; zeros are fine
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ClaudOpenAI — Universal Skills Marketplace</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><circle cx=%2250%22 cy=%2250%22 r=%2245%22 fill=%22%23BF5700%22/></svg>">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; background: #0A0A0A; color: #F5F2EB; line-height: 1.6; padding: 2rem 1rem; }
  .container { max-width: 820px; margin: 0 auto; }
  .stamp { display: inline-block; padding: 0.25rem 0.5rem; background: #BF5700; color: #F5F2EB; font-family: "Oswald", sans-serif; text-transform: uppercase; letter-spacing: 0.1em; font-size: 0.75rem; font-weight: 600; margin-bottom: 1rem; }
  h1 { font-size: clamp(2rem, 5vw, 3.5rem); font-weight: 700; margin-bottom: 1rem; letter-spacing: -0.02em; }
  .tagline { color: #C4B8A5; font-size: 1.125rem; margin-bottom: 2rem; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin: 2rem 0; }
  .stat { background: #161616; border: 1px solid rgba(140,98,57,0.3); padding: 1rem; border-radius: 4px; text-align: center; }
  .stat .n { font-size: 2rem; font-weight: 700; color: #BF5700; display: block; }
  .stat .l { color: #C4B8A5; font-size: 0.875rem; text-transform: uppercase; letter-spacing: 0.05em; }
  h2 { font-family: "Oswald", sans-serif; text-transform: uppercase; font-size: 1rem; letter-spacing: 0.1em; color: #4B9CD3; margin: 2rem 0 1rem; }
  pre { background: #161616; border: 1px solid rgba(140,98,57,0.3); padding: 1rem; border-radius: 4px; overflow-x: auto; font-size: 0.875rem; color: #F5F2EB; }
  code { font-family: "JetBrains Mono", ui-monospace, monospace; }
  a { color: #4B9CD3; text-decoration: none; }
  a:hover { color: #BF5700; text-decoration: underline; }
  ul { list-style: none; }
  ul li { padding: 0.25rem 0; padding-left: 1rem; position: relative; }
  ul li:before { content: "◆"; color: #BF5700; position: absolute; left: 0; font-size: 0.5rem; top: 0.75rem; }
  footer { margin-top: 3rem; padding-top: 2rem; border-top: 1px solid rgba(140,98,57,0.3); color: #C4B8A5; font-size: 0.875rem; }
  .notice { background: rgba(191,87,0,0.1); border-left: 3px solid #BF5700; padding: 0.75rem 1rem; margin: 1rem 0; }
</style>
</head>
<body>
<div class="container">
  <span class="stamp">Unofficial · Apache 2.0</span>
  <h1>ClaudOpenAI</h1>
  <p class="tagline">Context7 for skills, not docs. One MCP server, two ecosystems.</p>

  <div class="notice">
    <strong>Unofficial community project.</strong> Not affiliated with, endorsed by, or sponsored by Anthropic or OpenAI. All trademarks belong to their respective owners.
  </div>

  <div class="stats">
    <div class="stat"><span class="n">${totalCount}</span><span class="l">Total skills</span></div>
    <div class="stat"><span class="n">${claudeCount}</span><span class="l">Claude</span></div>
    <div class="stat"><span class="n">${codexCount}</span><span class="l">Codex</span></div>
  </div>

  <h2>Install — Claude Code</h2>
  <pre><code>{
  "mcpServers": {
    "universal-skills": {
      "command": "npx",
      "args": ["-y", "@blazesportsintel/universal-skills-mcp"]
    }
  }
}</code></pre>

  <h2>Install — OpenAI Codex</h2>
  <pre><code>[mcp_servers.universal-skills]
command = "npx"
args = ["-y", "@blazesportsintel/universal-skills-mcp"]</code></pre>

  <h2>Endpoints</h2>
  <ul>
    <li><a href="/.claude-plugin/marketplace.json">/.claude-plugin/marketplace.json</a> — Claude Code catalog</li>
    <li><a href="/.agents/plugins/marketplace.json">/.agents/plugins/marketplace.json</a> — OpenAI Codex catalog</li>
    <li><a href="https://api.marketplace.blazesportsintel.com/mcp">api.marketplace.blazesportsintel.com/mcp</a> — HTTP MCP endpoint</li>
    <li><a href="/.well-known/universal-skills.json">/.well-known/universal-skills.json</a> — federated discovery</li>
    <li><a href="/health">/health</a> — health check</li>
  </ul>

  <h2>Source</h2>
  <ul>
    <li><a href="https://github.com/ahump20/ClaudOpenAI">github.com/ahump20/ClaudOpenAI</a></li>
    <li><a href="https://www.npmjs.com/package/@blazesportsintel/universal-skills-mcp">npmjs.com/package/@blazesportsintel/universal-skills-mcp</a></li>
  </ul>

  <footer>
    <p>Born to Blaze the Path Beaten Less. Apache 2.0. v${env.REGISTRY_VERSION}.</p>
  </footer>
</div>
</body>
</html>`;
}
