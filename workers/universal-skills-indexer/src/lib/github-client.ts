/**
 * Worker-local GitHub API client — ETag-aware, rate-limit tracking.
 * Simpler than the npm-package variant (no fetch abstraction needed in Workers).
 */

export class RateLimitExceeded extends Error {
  name = "RateLimitExceeded";
  constructor(public readonly retryAfter: number) {
    super(`GitHub rate limit exceeded; retry after ${retryAfter}s`);
  }
}

export class GithubClient {
  public lastCore: number | null = null;
  public lastSearch: number | null = null;

  constructor(private readonly token: string) {}

  private headers(): Headers {
    return new Headers({
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "universal-skills-indexer/0.1",
      authorization: `Bearer ${this.token}`,
    });
  }

  private trackRateLimit(res: Response, isSearch = false): void {
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (remaining) {
      const n = Number.parseInt(remaining, 10);
      if (isSearch) this.lastSearch = n;
      else this.lastCore = n;
    }
    if (res.status === 429 || (res.status === 403 && remaining === "0")) {
      const reset = res.headers.get("x-ratelimit-reset");
      const retryAfter = reset
        ? Math.max(1, Number.parseInt(reset, 10) - Math.floor(Date.now() / 1000))
        : 60;
      throw new RateLimitExceeded(retryAfter);
    }
  }

  async getHeadSha(repo: string): Promise<string> {
    const repoRes = await fetch(`https://api.github.com/repos/${repo}`, { headers: this.headers() });
    this.trackRateLimit(repoRes);
    if (!repoRes.ok) throw new Error(`getRepo ${repo} failed: ${repoRes.status}`);
    const repoData = (await repoRes.json()) as { default_branch: string };

    const branchRes = await fetch(
      `https://api.github.com/repos/${repo}/branches/${repoData.default_branch}`,
      { headers: this.headers() },
    );
    this.trackRateLimit(branchRes);
    if (!branchRes.ok) throw new Error(`getBranch ${repo} failed: ${branchRes.status}`);
    const branch = (await branchRes.json()) as { commit: { sha: string } };
    return branch.commit.sha;
  }

  async listRelevantFiles(
    repo: string,
    sha: string,
    subdirs: string[],
  ): Promise<Array<{ path: string; sha: string; size: number }>> {
    const res = await fetch(`https://api.github.com/repos/${repo}/git/trees/${sha}?recursive=1`, {
      headers: this.headers(),
    });
    this.trackRateLimit(res);
    if (!res.ok) throw new Error(`getTree ${repo} failed: ${res.status}`);
    const data = (await res.json()) as {
      tree: Array<{ path: string; type: string; sha: string; size?: number }>;
      truncated: boolean;
    };

    const relevant = data.tree
      .filter((e) => e.type === "blob")
      .filter((e) => {
        // Accept only SKILL.md + plugin.json + marketplace.json under any subdir filter
        const isRelevantName =
          e.path.endsWith("/SKILL.md") ||
          e.path.endsWith(".claude-plugin/plugin.json") ||
          e.path.endsWith(".codex-plugin/plugin.json") ||
          e.path.endsWith(".claude-plugin/marketplace.json") ||
          e.path.endsWith(".agents/plugins/marketplace.json");
        if (!isRelevantName) return false;
        if (subdirs.length === 1 && subdirs[0] === ".") return true;
        return subdirs.some((d) => e.path.startsWith(d));
      })
      .map((e) => ({ path: e.path, sha: e.sha, size: e.size ?? 0 }));

    if (data.truncated) {
      console.warn(`[github-client] tree truncated for ${repo}; may be missing files`);
    }

    return relevant;
  }

  async getFileContent(repo: string, path: string, ref: string): Promise<string> {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${ref}`,
      { headers: this.headers() },
    );
    this.trackRateLimit(res);
    if (!res.ok) throw new Error(`getContents ${repo}:${path} failed: ${res.status}`);
    const data = (await res.json()) as { content: string; encoding: "base64" };
    if (data.encoding !== "base64") throw new Error(`unexpected encoding ${data.encoding}`);
    return atob(data.content.replace(/\n/g, ""));
  }
}
