/**
 * Registry interface with two implementations:
 *   - GitHubRegistry (Phase 2): direct GitHub Search + Contents API
 *   - HttpRegistry   (Phase 3): calls the universal-skills-api Worker
 *
 * Consumers get identical Promise<ResolveResult[]>/Promise<SkillContentResult>.
 */
import type { CanonicalSkill } from "@blazesportsintel/universal-skills-schema";
import { GitHubClient } from "./github-client.js";
import { scoreSkill } from "./scorer.js";
import { parseFrontmatter } from "./frontmatter.js";
import { LruMemoryCache, cacheKey } from "./cache.js";
import { SkillNotFoundError, RegistryUnavailableError } from "../errors.js";

// ============================================================================
// Interface types
// ============================================================================

export interface ResolveQuery {
  query: string;
  ecosystem?: "claude" | "codex" | "universal" | "any";
  category?: string;
  min_quality?: number;
  source_repo?: string;
  limit?: number;
}

export interface ResolveResult {
  id: string;
  name: string;
  description: string;
  quality_score: number;
  source_ecosystem: "claude" | "codex" | "universal";
  source_url: string;
  source_repo: string;
  compatibility: { claude: boolean; codex: boolean };
  install_commands: { claude: string; codex: string };
  content_hash: string;
}

export interface SkillContentPartial {
  id: string;
  version: string;
  metadata?: {
    name: string;
    description: string;
    frontmatter: Record<string, unknown>;
    source_url: string;
    quality_score: number;
  };
  body?: string;
  references?: Array<{ path: string; content: string; sha256: string; size_bytes: number }>;
  scripts?: Array<{ path: string; content: string; mode: string }>;
  assets?: Array<{ path: string; mime: string; url: string; size_bytes: number }>;
  canonical_json?: Record<string, unknown>;
}

export interface Registry {
  resolveSkills(query: ResolveQuery): Promise<ResolveResult[]>;
  getSkillContent(
    id: string,
    include: Array<"metadata" | "body" | "references" | "scripts" | "assets" | "canonical_json">,
    version?: string,
  ): Promise<SkillContentPartial>;
}

// ============================================================================
// GitHubRegistry — Phase 2 backend
// ============================================================================

export class GitHubRegistry implements Registry {
  private readonly github: GitHubClient;
  private readonly resolveCache = new LruMemoryCache<ResolveResult[]>({ max: 500, defaultTtlMs: 10 * 60_000 });
  private readonly contentCache = new LruMemoryCache<SkillContentPartial>({ max: 200, defaultTtlMs: 30 * 60_000 });

  constructor(github: GitHubClient) {
    this.github = github;
  }

  async resolveSkills(query: ResolveQuery): Promise<ResolveResult[]> {
    const key = cacheKey("resolve", query as unknown as Record<string, unknown>);
    const cached = await this.resolveCache.get(key);
    if (cached) return cached;

    const limit = Math.min(query.limit ?? 10, 50);
    const minQuality = query.min_quality ?? 30;

    // Build search query — restrict to SKILL.md files
    const repoFilter = query.source_repo ? ` repo:${query.source_repo}` : "";
    const ghQuery = `filename:SKILL.md ${query.query}${repoFilter}`;

    let searchResult;
    try {
      searchResult = await this.github.searchCode(ghQuery, Math.min(limit * 3, 50));
    } catch (err) {
      throw new RegistryUnavailableError(
        `GitHub search failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const candidates: ResolveResult[] = [];
    for (const item of searchResult.items) {
      try {
        const canonical = await this.fetchAsCanonical(item.repository.full_name, item.path);
        const score = scoreSkill(canonical);
        if (score.total < minQuality) continue;

        const ecosystem = detectEcosystem(item.path);
        if (query.ecosystem && query.ecosystem !== "any" && ecosystem !== query.ecosystem) continue;

        candidates.push({
          id: canonical.id,
          name: canonical.name,
          description: canonical.description,
          quality_score: score.total,
          source_ecosystem: ecosystem,
          source_url: item.html_url,
          source_repo: item.repository.full_name,
          compatibility: {
            claude: ecosystem === "claude" || ecosystem === "universal",
            codex: ecosystem === "codex" || ecosystem === "universal",
          },
          install_commands: buildInstallCommands(canonical, item.repository.full_name),
          content_hash: `sha256:${item.sha}`,
        });

        if (candidates.length >= limit) break;
      } catch {
        // Skip items we can't parse; they'll show up in logs server-side
        continue;
      }
    }

    candidates.sort((a, b) => b.quality_score - a.quality_score);
    await this.resolveCache.set(key, candidates);
    return candidates;
  }

  async getSkillContent(
    id: string,
    include: Array<"metadata" | "body" | "references" | "scripts" | "assets" | "canonical_json">,
    _version?: string,
  ): Promise<SkillContentPartial> {
    const key = cacheKey("content", { id, include });
    const cached = await this.contentCache.get(key);
    if (cached) return cached;

    // Parse `id` as "repo-slug/skill-name" — e.g. "anthropics-skills/pdf"
    const [slug, skillName] = parseId(id);
    if (!slug || !skillName) throw new SkillNotFoundError(`Malformed id: ${id}`);

    // This is a best-effort lookup for Phase 2 — HttpRegistry (Phase 3) has full D1
    // For Phase 2 we re-search to locate the path
    const results = await this.resolveSkills({ query: skillName, limit: 50 });
    const match = results.find((r) => r.id === id);
    if (!match) throw new SkillNotFoundError(`No skill with id ${id} found in current catalog`);

    const [owner, repo] = match.source_repo.split("/");
    if (!owner || !repo) throw new SkillNotFoundError(`Invalid source_repo ${match.source_repo}`);

    const version = "latest";
    const result: SkillContentPartial = { id, version };

    // Derive path from source_url
    const pathMatch = match.source_url.match(/\/blob\/[^/]+\/(.+)$/);
    const filePath = pathMatch?.[1];
    if (!filePath) throw new SkillNotFoundError("Could not parse file path from source_url");

    if (include.includes("metadata") || include.includes("body")) {
      try {
        const rawContent = await this.github.getContentsText(`${owner}/${repo}`, filePath);
        const parsed = parseFrontmatter(rawContent, filePath);
        if (include.includes("metadata")) {
          result.metadata = {
            name: parsed.frontmatter.name as string,
            description: parsed.frontmatter.description as string,
            frontmatter: parsed.frontmatter,
            source_url: match.source_url,
            quality_score: match.quality_score,
          };
        }
        if (include.includes("body")) {
          result.body = parsed.body;
        }
      } catch (err) {
        throw new SkillNotFoundError(
          `Failed to fetch content: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // references/ scripts/ assets/ would require listing the dir — deferred to Phase 3
    if (include.includes("references") || include.includes("scripts") || include.includes("assets")) {
      result.references = [];
      result.scripts = [];
      result.assets = [];
    }

    await this.contentCache.set(key, result);
    return result;
  }

  private async fetchAsCanonical(repo: string, path: string): Promise<CanonicalSkill> {
    const content = await this.github.getContentsText(repo, path);
    const parsed = parseFrontmatter(content, path);
    const id = `${repo.toLowerCase().replace(/\//g, "-").replace(/[^a-z0-9-]/g, "")}/${parsed.frontmatter.name as string}`;

    return {
      id,
      origin: {
        ecosystem: "standalone",
        sourcePath: path,
        sourceSha: null,
        repo,
        discoveredAt: new Date().toISOString(),
      },
      type: "skill",
      name: parsed.frontmatter.name as string,
      description: parsed.frontmatter.description as string,
      version: (parsed.frontmatter.version as string | undefined) ?? null,
      author: null,
      homepage: null,
      repository: `https://github.com/${repo}`,
      license: null,
      keywords: [],
      tags: [],
      category: null,
      skills: [
        {
          path: path.replace(/\/SKILL\.md$/, ""),
          name: parsed.frontmatter.name as string,
          description: parsed.frontmatter.description as string,
          version: (parsed.frontmatter.version as string | undefined) ?? null,
          frontmatter: parsed.frontmatter,
          body: parsed.body,
          references: [],
          scripts: [],
          assets: [],
          nestedAgents: [],
          skillInterface: null,
        },
      ],
      mcpServers: {},
      commands: [],
      hooks: null,
      agents: [],
      apps: {},
      interface: null,
      ecosystem_extensions: { claude: {}, codex: {} },
      translation_log: [],
      quality_score: 0,
      quality_breakdown: {},
      compatibility_flags: {},
      content_hash: "",
      last_verified: new Date().toISOString(),
      install_count: 0,
    };
  }
}

// ============================================================================
// HttpRegistry — Phase 3 backend (calls the Cloudflare Worker)
// ============================================================================

export class HttpRegistry implements Registry {
  private readonly baseUrl: string;
  private readonly doFetch: typeof fetch;

  constructor(baseUrl: string, fetchImpl?: typeof fetch) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.doFetch = fetchImpl ?? globalThis.fetch;
  }

  async resolveSkills(query: ResolveQuery): Promise<ResolveResult[]> {
    const res = await this.jsonRpc("tools/call", {
      name: "resolve-skill",
      arguments: query,
    });
    return (res.results as ResolveResult[]) ?? [];
  }

  async getSkillContent(
    id: string,
    include: Array<"metadata" | "body" | "references" | "scripts" | "assets" | "canonical_json">,
    version?: string,
  ): Promise<SkillContentPartial> {
    return (await this.jsonRpc("tools/call", {
      name: "get-skill-content",
      arguments: { id, include, version },
    })) as SkillContentPartial;
  }

  private async jsonRpc(method: string, params: unknown): Promise<Record<string, unknown>> {
    const res = await this.doFetch(`${this.baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!res.ok) throw new RegistryUnavailableError(`Registry HTTP ${res.status}`);
    const body = (await res.json()) as { result?: { content: Array<{ text: string }> }; error?: { code: number; message: string } };
    if (body.error) throw new RegistryUnavailableError(body.error.message);
    const firstText = body.result?.content[0]?.text;
    if (!firstText) return {};
    try {
      return JSON.parse(firstText);
    } catch {
      return { text: firstText };
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function detectEcosystem(path: string): "claude" | "codex" | "universal" {
  if (path.includes("/.claude-plugin/") || path.includes("claude-plugins-official")) return "claude";
  if (path.includes("/.codex-plugin/") || path.includes("openai-curated") || path.includes("openai/plugins")) return "codex";
  // agentskills.io SKILL.md-only — works everywhere
  return "universal";
}

function parseId(id: string): [string, string] {
  const idx = id.indexOf("/");
  if (idx < 0) return ["", id];
  return [id.slice(0, idx), id.slice(idx + 1)];
}

function buildInstallCommands(
  canonical: CanonicalSkill,
  sourceRepo: string,
): { claude: string; codex: string } {
  const name = canonical.name;
  return {
    claude: `/plugin marketplace add ${sourceRepo} && /plugin install ${name}@${sourceRepo.replace("/", "-")}`,
    codex: `$skill-installer install ${sourceRepo}/${name}`,
  };
}
