/**
 * GitHub API client — ETag-aware, rate-limit tracking, exponential backoff.
 * Used by the GitHubRegistry (Phase 2) and the indexer Worker (Phase 3).
 *
 * See references/08-github-indexer-design.md for the rate-limit budget math.
 */
import { GitHubRateLimitError, UpstreamFetchError } from "../errors.js";

export interface GitHubClientOptions {
  token?: string;
  userAgent?: string;
  fetch?: typeof fetch;
}

interface EtagEntry<T> {
  etag: string;
  body: T;
  fetchedAt: number;
}

export interface RepoMetadata {
  full_name: string;
  default_branch: string;
  stargazers_count: number;
  pushed_at: string;
  archived: boolean;
  license: { spdx_id: string } | null;
  description: string | null;
}

export interface CodeSearchItem {
  path: string;
  repository: { full_name: string };
  sha: string;
  html_url: string;
  url: string;
}

export interface CodeSearchResult {
  total_count: number;
  items: CodeSearchItem[];
}

export interface ContentsResponse {
  name: string;
  path: string;
  sha: string;
  size: number;
  encoding: "base64";
  content: string; // base64
}

export class GitHubClient {
  private readonly token: string | undefined;
  private readonly userAgent: string;
  private readonly doFetch: typeof fetch;
  private readonly etagCache = new Map<string, EtagEntry<unknown>>();
  public lastRemainingCore: number | null = null;
  public lastRemainingSearch: number | null = null;

  constructor(options: GitHubClientOptions = {}) {
    this.token = options.token;
    this.userAgent = options.userAgent ?? "universal-skills-mcp/0.1";
    this.doFetch = options.fetch ?? globalThis.fetch;
  }

  private headers(extra?: Record<string, string>): Headers {
    const h = new Headers({
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": this.userAgent,
      ...extra,
    });
    if (this.token) h.set("authorization", `Bearer ${this.token}`);
    return h;
  }

  private trackRateLimit(res: Response, isSearch: boolean): void {
    const remaining = res.headers.get("x-ratelimit-remaining");
    const reset = res.headers.get("x-ratelimit-reset");
    if (remaining) {
      const n = Number.parseInt(remaining, 10);
      if (isSearch) this.lastRemainingSearch = n;
      else this.lastRemainingCore = n;
    }
    if (res.status === 429 || (res.status === 403 && remaining === "0")) {
      const retryAfter = res.headers.get("retry-after");
      const seconds = retryAfter
        ? Number.parseInt(retryAfter, 10)
        : reset
          ? Math.max(1, Number.parseInt(reset, 10) - Math.floor(Date.now() / 1000))
          : 60;
      throw new GitHubRateLimitError(seconds);
    }
  }

  private async request<T>(
    url: string,
    options: { method?: "GET" | "POST"; headers?: Record<string, string>; useEtag?: boolean; isSearch?: boolean; body?: string } = {},
  ): Promise<T> {
    const cacheKey = options.useEtag ? url : null;
    const entry = cacheKey ? this.etagCache.get(cacheKey) : null;
    const headers = this.headers(options.headers);
    if (entry) headers.set("if-none-match", entry.etag);

    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await this.doFetch(url, {
          method: options.method ?? "GET",
          headers,
          body: options.body,
        });
        this.trackRateLimit(res, options.isSearch ?? false);

        if (res.status === 304 && entry) {
          return entry.body as T;
        }
        if (!res.ok) {
          if (res.status >= 500 && attempt < 2) {
            await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
            continue;
          }
          throw new UpstreamFetchError(`GitHub ${res.status}: ${url}`, { status: res.status });
        }
        const body = (await res.json()) as T;
        if (cacheKey) {
          const etag = res.headers.get("etag");
          if (etag) this.etagCache.set(cacheKey, { etag, body, fetchedAt: Date.now() });
        }
        return body;
      } catch (err) {
        if (err instanceof GitHubRateLimitError) throw err;
        lastErr = err;
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
          continue;
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new UpstreamFetchError(String(lastErr));
  }

  async getRepo(repo: string): Promise<RepoMetadata> {
    return this.request<RepoMetadata>(`https://api.github.com/repos/${repo}`, { useEtag: true });
  }

  async getDefaultBranchHead(repo: string): Promise<string> {
    const meta = await this.getRepo(repo);
    const branch = await this.request<{ commit: { sha: string } }>(
      `https://api.github.com/repos/${repo}/branches/${meta.default_branch}`,
      { useEtag: true },
    );
    return branch.commit.sha;
  }

  async searchCode(query: string, perPage = 30): Promise<CodeSearchResult> {
    return this.request<CodeSearchResult>(
      `https://api.github.com/search/code?q=${encodeURIComponent(query)}&per_page=${perPage}`,
      { useEtag: true, isSearch: true },
    );
  }

  async getContents(repo: string, path: string, ref?: string): Promise<ContentsResponse> {
    const refSuffix = ref ? `?ref=${ref}` : "";
    return this.request<ContentsResponse>(
      `https://api.github.com/repos/${repo}/contents/${path}${refSuffix}`,
      { useEtag: true },
    );
  }

  async getContentsText(repo: string, path: string, ref?: string): Promise<string> {
    const data = await this.getContents(repo, path, ref);
    if (data.encoding !== "base64") {
      throw new UpstreamFetchError(`Unexpected encoding ${data.encoding} for ${path}`);
    }
    // atob is browser API; use Buffer in Node.js
    return typeof Buffer !== "undefined"
      ? Buffer.from(data.content, "base64").toString("utf8")
      : atob(data.content.replace(/\n/g, ""));
  }

  async getTree(repo: string, sha: string, recursive = true): Promise<{
    tree: Array<{ path: string; type: "blob" | "tree"; sha: string; size?: number }>;
    truncated: boolean;
  }> {
    const suffix = recursive ? "?recursive=1" : "";
    return this.request(`https://api.github.com/repos/${repo}/git/trees/${sha}${suffix}`, {
      useEtag: true,
    });
  }
}
