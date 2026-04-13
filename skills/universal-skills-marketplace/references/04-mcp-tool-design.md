# 04 — MCP Tool Design

How the three tools (`resolve-skill`, `get-skill-content`, `install-skill`) are shaped, what inputs they accept, what outputs they return, and how they fit the **Pattern B (search + execute)** strategy from Anthropic's canonical [`build-mcp-server`](file:///Users/AustinHumphrey/.claude/plugins/marketplaces/claude-plugins-official/plugins/mcp-server-dev/skills/build-mcp-server/SKILL.md) skill.

## Why Pattern B and not one-tool-per-action

Per `build-mcp-server` Phase 3, Pattern B fits when the action space is large. Our catalog will grow from ~50 to potentially thousands of skills as upstream repos evolve. Exposing one tool per skill would flood Claude's context window. Instead:

- `resolve-skill` = search (returns IDs + lightweight metadata)
- `get-skill-content` = fetch one specific skill's content (progressive disclosure)
- `install-skill` = action on a resolved skill (write or emit command)

The server holds the full catalog internally. Client searches, picks, fetches, executes. Context stays lean.

## Tool surface summary

| Tool | Purpose | When Claude/Codex invokes it |
|------|---------|-------------------------------|
| `resolve-skill` | Find skills matching natural-language query + filters | User asks "find a skill for X"; assistant is choosing between candidates |
| `get-skill-content` | Fetch parsed SKILL.md (metadata / body / references / scripts / assets) | After resolve, before install, when assistant needs to reason about a specific skill |
| `install-skill` | Emit install command OR write skill to disk | User confirms install |

## Tool 1: `resolve-skill`

### Purpose

Given a natural-language query plus optional filters, return ranked matching skills from the catalog. Uses D1 FTS5 BM25 ranking on Phase 3; in-memory substring + GitHub Code Search for Phase 2.

### Input schema (zod)

```ts
import { z } from "zod";

export const ResolveSkillInput = z.object({
  query: z.string().min(1).max(500)
    .describe("Natural-language query. Example: 'PDF processing', 'React component scaffolding', 'Stripe webhook validation'"),

  ecosystem: z.enum(["claude", "codex", "universal", "any"]).default("any")
    .describe("Filter by source ecosystem. 'universal' = works in both without translation. 'any' = no filter."),

  category: z.string().optional()
    .describe("Filter by Codex-style category (e.g. 'Coding', 'Productivity', 'Communication', 'Research', 'Design'). Matches against canonical.category."),

  min_quality: z.number().int().min(0).max(100).default(30)
    .describe("Minimum quality score 0-100. Default 30 excludes obvious stubs."),

  source_repo: z.string().optional()
    .describe("Filter by upstream source repo, e.g. 'anthropics/skills' or 'openai/plugins'"),

  limit: z.number().int().min(1).max(50).default(10)
    .describe("Max results to return"),
});
```

Descriptions matter: Claude reads these into the tool-call decision. Be precise.

### Output shape

```ts
export const ResolveSkillOutput = z.object({
  results: z.array(z.object({
    id: z.string(),                              // e.g. "anthropics-skills/pdf"
    name: z.string(),
    description: z.string(),
    quality_score: z.number().int().min(0).max(100),
    source_ecosystem: z.enum(["claude", "codex", "universal"]),
    source_url: z.string().url(),                // link to upstream repo @ commit
    compatibility: z.object({
      claude: z.boolean(),
      codex: z.boolean(),
    }),
    install_commands: z.object({
      claude: z.string(),                        // e.g. "/plugin install pdf@anthropics-skills"
      codex: z.string(),                         // e.g. "$skill-installer install openai-curated/canva"
    }),
    content_hash: z.string(),                    // sha256 of canonical JSON
  })),
  meta: z.object({
    source: z.literal("universal-skills-marketplace"),
    fetched_at: z.string().datetime(),
    timezone: z.literal("America/Chicago"),
    registry_version: z.string(),                // e.g. "0.1.0"
    cache_hit: z.boolean(),
    query_time_ms: z.number(),
  }),
});
```

### Error cases (typed)

| Error | Code | When |
|-------|------|------|
| `ValidationError` | 400 | Zod input validation fails |
| `RegistryUnavailableError` | 503 | D1 query times out, indexer in bad state |
| `GitHubRateLimitError` | 429 | (Phase 2 only) GitHub API quota exhausted; returns `retry_after_seconds` |
| `NoResultsError` | 200 | Empty results array; includes suggested alternate queries |

Empty results are NOT errors — they're a successful query with an empty result set. Claude should handle that state gracefully (suggest broader terms, or `ecosystem=any`).

### Implementation hook — Phase 2 (GitHub-backed)

```ts
export async function resolveSkill(input: z.infer<typeof ResolveSkillInput>) {
  const validated = ResolveSkillInput.parse(input);
  const cacheKey = sha1(JSON.stringify(validated));
  const cached = await cache.get(cacheKey);
  if (cached) return { ...cached, meta: { ...cached.meta, cache_hit: true }};

  // GitHub Search: filename:SKILL.md + query
  const ghResults = await githubClient.searchCode({
    q: `filename:SKILL.md "${validated.query}"`,
    per_page: Math.min(validated.limit * 2, 50),
  });

  // Score, rank, filter, trim
  const results = await Promise.all(
    ghResults.items.map(async (item) => {
      const content = await githubClient.getContents(item.url);
      const canonical = await translator.toCanonical(content, detectEcosystem(item.path));
      const score = scorer.scoreSkill(canonical);
      return canonicalToResolveResult(canonical, score);
    })
  );

  const filtered = results
    .filter(r => r.quality_score >= validated.min_quality)
    .slice(0, validated.limit);

  await cache.set(cacheKey, { results: filtered, meta: { ... }}, 600);
  return { results: filtered, meta: { source: "...", fetched_at: new Date().toISOString(), cache_hit: false, ... }};
}
```

### Implementation hook — Phase 3 (D1-backed)

```ts
export async function resolveSkill(env: Env, input: z.infer<typeof ResolveSkillInput>) {
  const validated = ResolveSkillInput.parse(input);

  const sql = `
    SELECT s.id, s.name, s.description, s.quality_score, s.source_ecosystem, s.source_url,
           s.compat_claude, s.compat_codex, s.content_hash, bm25(skills_fts) as rank
    FROM skills s
    JOIN skills_fts fts ON s.rowid = fts.rowid
    WHERE skills_fts MATCH ?
      AND s.quality_score >= ?
      AND s.tombstoned = 0
      ${validated.ecosystem !== "any" ? "AND s.source_ecosystem = ?" : ""}
      ${validated.category ? "AND s.tags LIKE ?" : ""}
    ORDER BY rank
    LIMIT ?
  `;
  const bindings = [validated.query, validated.min_quality, ...conditionalBindings, validated.limit];
  const rows = await env.DB.prepare(sql).bind(...bindings).all();

  return {
    results: rows.results.map(rowToResolveResult),
    meta: { source: "universal-skills-marketplace", fetched_at: new Date().toISOString(), ... },
  };
}
```

## Tool 2: `get-skill-content`

### Purpose

Fetch a specific skill's content with progressive disclosure. Metadata is cheap; references can be heavy. Client asks for what it needs.

### Input schema

```ts
export const GetSkillContentInput = z.object({
  id: z.string().describe("Skill ID as returned by resolve-skill. Format: '{source}/{name}' e.g. 'anthropics-skills/pdf'"),
  include: z.array(z.enum(["metadata", "body", "references", "scripts", "assets", "canonical_json"]))
    .default(["metadata", "body"])
    .describe("Which parts to return. 'metadata' is always cheap; 'references' can be heavy. Request only what you need."),
  version: z.string().optional().describe("Specific version. Defaults to latest."),
});
```

### Output shape

```ts
export const GetSkillContentOutput = z.object({
  id: z.string(),
  version: z.string(),
  metadata: z.object({
    name: z.string(),
    description: z.string(),
    frontmatter: z.record(z.unknown()),          // raw parsed YAML frontmatter
    trigger_keywords: z.array(z.string()),
    source_url: z.string().url(),
    quality_score: z.number(),
  }).optional(),
  body: z.string().optional(),                    // the SKILL.md body (without frontmatter)
  references: z.array(z.object({
    path: z.string(),                             // relative: "references/00-architecture-overview.md"
    content: z.string(),
    sha256: z.string(),
    size_bytes: z.number(),
  })).optional(),
  scripts: z.array(z.object({
    path: z.string(),
    content: z.string(),
    mode: z.string(),                             // e.g. "755" for executables
  })).optional(),
  assets: z.array(z.object({
    path: z.string(),
    mime: z.string(),
    url: z.string().url(),                        // R2 signed URL for binary downloads
    size_bytes: z.number(),
  })).optional(),
  canonical_json: z.record(z.unknown()).optional(),
  meta: z.object({
    source: z.literal("universal-skills-marketplace"),
    fetched_at: z.string().datetime(),
    timezone: z.literal("America/Chicago"),
  }),
});
```

### Progressive disclosure examples

**Cheap:**
```json
{"id": "anthropics-skills/pdf", "include": ["metadata"]}
→ returns name + description + frontmatter only (~500 bytes)
```

**Standard:**
```json
{"id": "anthropics-skills/pdf"}   // include defaults to ["metadata","body"]
→ adds SKILL.md body (typically 5-20KB)
```

**Deep-dive:**
```json
{"id": "anthropics-skills/pdf", "include": ["metadata","body","references","scripts"]}
→ adds all reference files (can be 100KB+)
```

**Binary assets:**
```json
{"id": "anthropics-skills/pdf", "include": ["assets"]}
→ returns signed R2 URLs (not inline bytes). Client fetches what it wants.
```

### Error cases

| Error | Code | When |
|-------|------|------|
| `SkillNotFoundError` | 404 | No skill with this id |
| `VersionNotFoundError` | 404 | Skill exists but that version doesn't |
| `UpstreamFetchError` | 502 | R2 fetch failed or GitHub fetch failed |
| `ContentIntegrityError` | 500 | Returned content's sha256 doesn't match D1 `content_hash` — something's corrupted |

## Tool 3: `install-skill`

### Purpose

Either emit the exact install command for the target ecosystem OR write the skill directly to disk.

### Input schema

```ts
export const InstallSkillInput = z.object({
  id: z.string(),
  target: z.enum(["claude", "codex", "auto-detect"]).default("auto-detect")
    .describe("Which ecosystem's install layout to produce. 'auto-detect' reads $CLAUDE_CONFIG_DIR or $CODEX_HOME presence."),
  mode: z.enum(["command-only", "write-to-disk"]).default("command-only")
    .describe("'command-only' returns a shell command for the user to run. 'write-to-disk' writes files directly to the ecosystem skills dir."),
  scope: z.enum(["user", "project"]).default("user")
    .describe("'user' = ~/.claude/skills/ or ~/.codex/skills/. 'project' = .claude/skills/ or .codex/skills/ in $CWD."),
});
```

### Output shape

```ts
export const InstallSkillOutput = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("command-only"),
    ecosystem: z.enum(["claude", "codex"]),
    command: z.string(),                          // e.g. "/plugin install pdf@anthropics-skills"
    target_dir: z.string(),                       // where the command will install to
    notes: z.array(z.string()),                   // e.g. ["Requires Claude Code 2.1.76+"]
  }),
  z.object({
    mode: z.literal("write-to-disk"),
    ecosystem: z.enum(["claude", "codex"]),
    target_dir: z.string(),
    written: z.array(z.object({
      path: z.string(),
      sha256: z.string(),
      size_bytes: z.number(),
    })),
    skipped: z.array(z.object({
      path: z.string(),
      reason: z.string(),                         // e.g. "already exists with different sha256"
    })),
  }),
]);
```

### Auto-detect logic

```ts
function autoDetectTarget(): "claude" | "codex" | null {
  const claudeExists = fs.existsSync(path.join(os.homedir(), ".claude"));
  const codexExists = fs.existsSync(path.join(os.homedir(), ".codex"));
  if (claudeExists && !codexExists) return "claude";
  if (codexExists && !claudeExists) return "codex";
  if (claudeExists && codexExists) return null;   // ambiguous — ask user
  return null;
}
```

If ambiguous, return `AmbiguousTargetError` (code 400) asking the user to specify explicitly.

### Safety

- `write-to-disk` will NEVER overwrite files with different sha256. Either skips (preserving user's version) or errors if a force flag is added in a future version.
- `write-to-disk` only writes to `~/.claude/skills/` or `~/.codex/skills/` or `./.claude/skills/` or `./.codex/skills/` — nowhere else, ever. Path traversal is blocked.
- All install paths are normalized with `path.resolve` + a suffix check before any write.

### Error cases

| Error | Code |
|-------|------|
| `AmbiguousTargetError` | 400 — both ecosystems present, `target` was `auto-detect` |
| `SkillNotFoundError` | 404 |
| `WriteProtectedError` | 403 — target dir not writable |
| `PathEscapeAttempt` | 400 — sanitization caught an attempt to write outside allowed dirs |

## Tool metadata for MCP registration

```ts
server.registerTool({
  name: "resolve-skill",
  description: "Search the ClaudOpenAI universal skills marketplace for skills matching a natural-language query. Returns ranked results with quality scores and install commands for both Claude Code and Codex. Use when the user asks to 'find a skill for X' or 'search for skills'.",
  inputSchema: zodToJsonSchema(ResolveSkillInput),
  handler: resolveSkillHandler,
});

server.registerTool({
  name: "get-skill-content",
  description: "Fetch the full content of a specific skill by ID (as returned by resolve-skill). Supports progressive disclosure: fetch just metadata, or pull references/scripts/assets as needed. Use when you need to inspect a skill's SKILL.md body or reference files before installing.",
  inputSchema: zodToJsonSchema(GetSkillContentInput),
  handler: getSkillContentHandler,
});

server.registerTool({
  name: "install-skill",
  description: "Install a resolved skill either by emitting the exact CLI command (default, safe) or by writing files directly to the appropriate ecosystem skills directory (mode='write-to-disk'). Auto-detects target ecosystem from ~/.claude or ~/.codex presence.",
  inputSchema: zodToJsonSchema(InstallSkillInput),
  handler: installSkillHandler,
});
```

## Response formatting best practices

- Tool descriptions land in Claude's context. Keep them one-to-three sentences, concrete.
- `describe()` on every zod field. Claude uses these.
- Return ISO 8601 timestamps (`Z` suffix). Let the client parse.
- Never return `undefined` or `null` for required fields. Return the typed error.
- `meta` block on EVERY response. Consistency matters to the client.

## Testing

Unit tests per tool in `packages/mcp-server/tests/unit/tools/*.test.ts`. Integration tests gated behind `CI_REAL_GITHUB=1` flag (they consume rate limit). See [`12-verification-playbook.md`](12-verification-playbook.md) for the full matrix.

## See also

- `build-mcp-server` skill `references/tool-design.md` — deep dive on description writing
- [`11-manifest-translator-algorithm.md`](11-manifest-translator-algorithm.md) — what the tools serve
- `build-mcp-server` Phase 3 (Pattern B vs Pattern A trade-offs)
