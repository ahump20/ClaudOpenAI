/**
 * install-skill handler (Phase 3 — command-only mode; disk writes happen client-side).
 *
 * The Worker cannot write to the user's local filesystem. When mode=write-to-disk is
 * requested, we return the rendered SKILL.md + paths and the client performs the write.
 */
import type { Env } from "../index.js";

interface InstallArgs {
  id: string;
  target?: "claude" | "codex" | "auto-detect";
  mode?: "command-only" | "write-to-disk";
  scope?: "user" | "project";
}

export async function handleInstallSkill(env: Env, args: unknown): Promise<Record<string, unknown>> {
  const input = validateArgs(args);

  const skill = await env.DB.prepare(
    "SELECT id, name, description, source_repo, source_url FROM skills WHERE id = ? AND tombstoned = 0",
  )
    .bind(input.id)
    .first<{
      id: string;
      name: string;
      description: string;
      source_repo: string;
      source_url: string;
    } | null>();

  if (!skill) {
    return {
      error: "skill_not_found",
      id: input.id,
      meta: {
        source: "universal-skills-marketplace",
        fetched_at: new Date().toISOString(),
        timezone: "America/Chicago",
      },
    };
  }

  const target = input.target === "auto-detect" ? "claude" : input.target; // Worker can't detect local FS; default to claude
  const targetDir = target === "claude" ? "~/.claude/skills/" : "~/.codex/skills/";

  if (input.mode === "command-only") {
    const command =
      target === "claude"
        ? `/plugin marketplace add ${skill.source_repo} && /plugin install ${skill.name}@${skill.source_repo.replace("/", "-")}`
        : `$skill-installer install ${skill.source_repo}/${skill.name}`;

    return {
      mode: "command-only",
      ecosystem: target,
      command,
      target_dir: `${targetDir}${skill.name}/`,
      source_url: skill.source_url,
      notes:
        target === "claude"
          ? ["Requires Claude Code 2.1.76+."]
          : ["Requires Codex CLI with plugin support."],
      meta: {
        source: "universal-skills-marketplace",
        fetched_at: new Date().toISOString(),
        timezone: "America/Chicago",
      },
    };
  }

  // write-to-disk mode — Worker returns rendered content; client performs the write
  const r2Object = await env.CONTENT.get(`skills/${skill.id}/latest/skill.md`);
  const content = r2Object ? await r2Object.text() : null;

  return {
    mode: "write-to-disk-via-client",
    ecosystem: target,
    target_dir: `${targetDir}${skill.name}/`,
    files: content
      ? [
          {
            path: "SKILL.md",
            content,
          },
        ]
      : [],
    note:
      "Worker-side install is command-only. For direct write-to-disk, use the npm package: `npx @blazesportsintel/universal-skills-mcp` with mode=write-to-disk.",
    meta: {
      source: "universal-skills-marketplace",
      fetched_at: new Date().toISOString(),
      timezone: "America/Chicago",
    },
  };
}

function validateArgs(args: unknown): Required<InstallArgs> {
  if (!args || typeof args !== "object") throw new Error("Missing arguments");
  const a = args as Partial<InstallArgs>;
  if (!a.id || typeof a.id !== "string") throw new Error("'id' is required (string)");
  return {
    id: a.id,
    target: a.target ?? "auto-detect",
    mode: a.mode ?? "command-only",
    scope: a.scope ?? "user",
  };
}
