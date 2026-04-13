/**
 * install-skill — emit install command OR write skill to disk.
 * Safe-by-default: command-only mode just returns the CLI invocation.
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Registry } from "../lib/registry.js";
import { AmbiguousTargetError, PathEscapeAttempt, WriteProtectedError } from "../errors.js";

export const InstallSkillInputSchema = z.object({
  id: z.string(),
  target: z
    .enum(["claude", "codex", "auto-detect"])
    .default("auto-detect")
    .describe(
      "Which ecosystem's install layout to produce. 'auto-detect' reads filesystem presence of ~/.claude vs ~/.codex.",
    ),
  mode: z
    .enum(["command-only", "write-to-disk"])
    .default("command-only")
    .describe(
      "'command-only' returns a shell/slash command for the user. 'write-to-disk' writes files directly to the ecosystem skills dir.",
    ),
  scope: z
    .enum(["user", "project"])
    .default("user")
    .describe(
      "'user' = ~/.claude/skills or ~/.codex/skills. 'project' = .claude/skills or .codex/skills in $CWD.",
    ),
});

export type InstallSkillInput = z.infer<typeof InstallSkillInputSchema>;

export const INSTALL_SKILL_TOOL_DEF = {
  name: "install-skill",
  description:
    "Install a resolved skill either by emitting the exact CLI command (default, safe) or by writing files directly to the ecosystem skills directory. Auto-detects target ecosystem from ~/.claude or ~/.codex presence. Will NEVER overwrite existing files with different content.",
  inputSchema: zodToJsonSchema(InstallSkillInputSchema),
} as const;

export async function handleInstallSkill(
  registry: Registry,
  args: unknown,
): Promise<Record<string, unknown>> {
  const input = InstallSkillInputSchema.parse(args);
  const target = input.target === "auto-detect" ? autoDetectTarget() : input.target;
  if (!target) {
    throw new AmbiguousTargetError(
      "Both ~/.claude and ~/.codex exist. Specify target explicitly: 'claude' or 'codex'.",
    );
  }

  const targetDir = resolveTargetDir(target, input.scope);
  const skill = await registry.getSkillContent(input.id, ["metadata", "body"]);
  const skillName = skill.metadata?.name ?? input.id.split("/").pop() ?? "skill";

  if (input.mode === "command-only") {
    return {
      mode: "command-only",
      ecosystem: target,
      command: buildCommand(target, input.id, skillName),
      target_dir: targetDir,
      notes: buildNotes(target, skill),
      meta: {
        source: "universal-skills-marketplace",
        fetched_at: new Date().toISOString(),
        timezone: "America/Chicago",
      },
    };
  }

  // write-to-disk mode
  const skillDir = join(targetDir, skillName);
  assertSafePath(targetDir, skillDir);
  if (!existsSync(targetDir)) {
    try {
      mkdirSync(targetDir, { recursive: true });
    } catch (err) {
      throw new WriteProtectedError(`Cannot create ${targetDir}`, { cause: String(err) });
    }
  }
  mkdirSync(skillDir, { recursive: true });

  const written: Array<{ path: string; sha256: string; size_bytes: number }> = [];
  const skipped: Array<{ path: string; reason: string }> = [];

  const skillMdPath = join(skillDir, "SKILL.md");
  if (skill.body && skill.metadata) {
    const frontmatter = renderFrontmatterBlock(skill.metadata.frontmatter);
    const content = `${frontmatter}\n${skill.body}`;

    if (existsSync(skillMdPath)) {
      skipped.push({ path: skillMdPath, reason: "already exists (use force flag to overwrite)" });
    } else {
      writeFileSync(skillMdPath, content, "utf8");
      written.push({
        path: skillMdPath,
        sha256: `sha256:${await sha256Hex(content)}`,
        size_bytes: Buffer.byteLength(content, "utf8"),
      });
    }
  }

  return {
    mode: "write-to-disk",
    ecosystem: target,
    target_dir: targetDir,
    written,
    skipped,
    meta: {
      source: "universal-skills-marketplace",
      fetched_at: new Date().toISOString(),
      timezone: "America/Chicago",
    },
  };
}

function autoDetectTarget(): "claude" | "codex" | null {
  const home = homedir();
  const claudeExists = existsSync(join(home, ".claude"));
  const codexExists = existsSync(join(home, ".codex"));
  if (claudeExists && !codexExists) return "claude";
  if (codexExists && !claudeExists) return "codex";
  return null; // ambiguous
}

function resolveTargetDir(target: "claude" | "codex", scope: "user" | "project"): string {
  const base = scope === "user" ? homedir() : process.cwd();
  const dir = target === "claude" ? ".claude/skills" : ".codex/skills";
  return scope === "user" ? join(base, dir) : join(base, dir);
}

function assertSafePath(root: string, target: string): void {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  if (!resolvedTarget.startsWith(resolvedRoot + "/") && resolvedTarget !== resolvedRoot) {
    throw new PathEscapeAttempt(
      `Refusing to write outside target dir; got ${resolvedTarget} (root ${resolvedRoot})`,
    );
  }
}

function buildCommand(target: "claude" | "codex", id: string, skillName: string): string {
  if (target === "claude") {
    const [repo] = id.split("/");
    return `/plugin marketplace add ${repo || "unknown"} && /plugin install ${skillName}@${repo || "unknown"}`;
  }
  return `$skill-installer install ${id}`;
}

function buildNotes(target: "claude" | "codex", _skill: unknown): string[] {
  const notes: string[] = [];
  if (target === "claude") notes.push("Requires Claude Code 2.1.76+ for full skill feature support.");
  if (target === "codex") notes.push("Requires Codex CLI with plugin support (PR #12864+).");
  return notes;
}

function renderFrontmatterBlock(fm: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(fm)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string") lines.push(`${k}: ${v.includes("\n") ? JSON.stringify(v) : v}`);
    else if (typeof v === "boolean" || typeof v === "number") lines.push(`${k}: ${v}`);
    else lines.push(`${k}: ${JSON.stringify(v)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

async function sha256Hex(input: string): Promise<string> {
  if (typeof globalThis.crypto?.subtle !== "undefined") {
    const buf = new TextEncoder().encode(input);
    const hash = await globalThis.crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Node < 20 fallback
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(input).digest("hex");
}
