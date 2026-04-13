# @blazesportsintel/universal-skills-schema

Zod + JSON Schema source-of-truth for the ClaudOpenAI universal skills marketplace.

Part of the [ClaudOpenAI](https://github.com/ahump20/ClaudOpenAI) monorepo. Unofficial project — not affiliated with Anthropic or OpenAI.

## What it exports

- `CanonicalSkillSchema` — intermediate format the translator produces/consumes. See [algorithm reference](../../skills/universal-skills-marketplace/references/11-manifest-translator-algorithm.md).
- `ClaudePluginSchema` — shape of `.claude-plugin/plugin.json`. Near-minimal; directory conventions carry the rest.
- `CodexPluginSchema` — shape of `.codex-plugin/plugin.json`. Rich, with `interface{}` block.
- `ClaudeMcpJsonSchema` — flat `.mcp.json` (Claude shape).
- `CodexMcpJsonSchema` — wrapped `.mcp.json` (Codex shape, outer `mcpServers` key).
- `ClaudeHooksJsonSchema` — shared hooks.json shape.
- `CodexAppJsonSchema` — `.app.json` connector registry (Codex-only).

## Install

```bash
npm install @blazesportsintel/universal-skills-schema
```

## Usage

```ts
import { CanonicalSkillSchema, ClaudePluginSchema } from "@blazesportsintel/universal-skills-schema";

// Parse a Claude plugin.json
const plugin = ClaudePluginSchema.parse(JSON.parse(pluginJsonText));

// Build a canonical record
const canonical = CanonicalSkillSchema.parse({
  id: "my-org/my-skill",
  origin: { ecosystem: "claude", sourcePath: "...", sourceSha: null },
  type: "plugin",
  name: "my-skill",
  description: "does X",
  // defaults fill in the rest
});
```

## License

Apache 2.0. See [LICENSE](../../LICENSE).
