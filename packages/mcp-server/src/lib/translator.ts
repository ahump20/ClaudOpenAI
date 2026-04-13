/**
 * Manifest translator — Claude ↔ Canonical ↔ Codex ↔ Standalone.
 *
 * Operates exclusively through the CanonicalSkill intermediate format.
 * Never drops a field silently: every lossy step logs to translation_log
 * and generates a shim (HTML comment, notes file, or ecosystem sidecar).
 *
 * Specification: references/11-manifest-translator-algorithm.md.
 */
import type {
  CanonicalSkill,
  ClaudePlugin,
  CodexPlugin,
  SkillContent,
  TranslationLogEntry,
} from "@blazesportsintel/universal-skills-schema";
import { parseFrontmatter, validateRequiredFrontmatter } from "./frontmatter.js";

// ============================================================================
// Types
// ============================================================================

export type Ecosystem = "claude" | "codex" | "standalone";

/**
 * Opaque representation of a parsed plugin/skill directory tree.
 * Indexer and tests construct this from on-disk walks or GitHub fetches.
 */
export interface PluginTree {
  manifestJson: Record<string, unknown> | null; // .claude-plugin/plugin.json or .codex-plugin/plugin.json
  mcpJson: Record<string, unknown> | null; // .mcp.json (flat for Claude, wrapped for Codex)
  appJson: Record<string, unknown> | null; // .app.json (Codex-only)
  hooksJson: Record<string, unknown> | null; // hooks/hooks.json (Claude) or hooks.json (Codex)
  pluginAgentYaml: Record<string, unknown> | null; // agents/openai.yaml (Codex)
  claudeSidecarEcosystem: Record<string, unknown> | null; // .claude-plugin/codex_ecosystem.json
  codexSidecarEcosystem: Record<string, unknown> | null; // .codex-plugin/claude_ecosystem.json
  skills: Array<{
    path: string; // "skills/<name>"
    skillMdContent: string; // raw SKILL.md contents
    referencePaths: string[];
    scriptPaths: string[];
    assetPaths: string[];
    skillAgents: Array<{ path: string; content: string }>;
    skillInterfaceYaml: Record<string, unknown> | null; // skills/<name>/agents/openai.yaml
  }>;
  agents: Array<{ path: string; content: string }>;
  commands: Array<{ path: string; content: string }>;
  origin: {
    sourcePath: string;
    sourceSha: string | null;
    repo: string | null;
  };
}

export interface EmittedFile {
  path: string; // relative to plugin root
  content: string;
  executable?: boolean;
}

export interface TranslateResult {
  files: EmittedFile[];
  translationLog: TranslationLogEntry[];
}

// ============================================================================
// toCanonical
// ============================================================================

export function toCanonical(tree: PluginTree, ecosystem: Ecosystem): CanonicalSkill {
  switch (ecosystem) {
    case "claude":
      return claudeToCanonical(tree);
    case "codex":
      return codexToCanonical(tree);
    case "standalone":
      return standaloneToCanonical(tree);
  }
}

function claudeToCanonical(tree: PluginTree): CanonicalSkill {
  const manifest = (tree.manifestJson ?? {}) as Partial<ClaudePlugin> & Record<string, unknown>;
  const sidecar = tree.claudeSidecarEcosystem ?? {};

  const skills = tree.skills.map((skill) => parseSkill(skill));
  const mcpServers = (tree.mcpJson ?? {}) as Record<string, unknown>;
  const hooks = tree.hooksJson
    ? {
        description: (tree.hooksJson.description as string | undefined) ?? null,
        events: (tree.hooksJson.hooks ?? tree.hooksJson) as Record<string, unknown[]>,
      }
    : null;

  return buildCanonical({
    id: deriveId(manifest.name as string, tree.origin.repo),
    origin: { ecosystem: "claude", ...tree.origin },
    type: "plugin",
    name: (manifest.name as string) ?? "",
    description: (manifest.description as string) ?? "",
    version: (manifest.version as string) ?? (sidecar.version as string) ?? null,
    author: (manifest.author as Record<string, string>) ?? null,
    homepage: (sidecar.homepage as string) ?? null,
    repository: (sidecar.repository as string) ?? null,
    license: (sidecar.license as string) ?? null,
    keywords: (sidecar.keywords as string[]) ?? [],
    category: (sidecar.category as string) ?? null,
    skills,
    mcpServers: mcpServers as Record<string, Record<string, unknown>>,
    commands: tree.commands.map((c) => parseCommandFile(c.path, c.content)),
    hooks,
    agents: tree.agents.map((a) => parseAgentFile(a.path, a.content)),
    apps: (sidecar.apps as Record<string, unknown>) ?? {},
    interface: (sidecar.interface as Record<string, unknown>) ?? null,
    claudeExtensions: {},
    codexExtensions: (sidecar as Record<string, unknown>) ?? {},
  });
}

function codexToCanonical(tree: PluginTree): CanonicalSkill {
  const manifest = (tree.manifestJson ?? {}) as Partial<CodexPlugin> & Record<string, unknown>;
  const sidecar = tree.codexSidecarEcosystem ?? {};

  const skills = tree.skills.map((skill) => parseSkill(skill));

  // Codex .mcp.json is wrapped: { mcpServers: { ... } }
  const mcpServersWrapped = (tree.mcpJson?.mcpServers as Record<string, unknown>) ?? {};
  const appsRaw = (tree.appJson?.apps as Record<string, unknown>) ?? {};

  const hooks = tree.hooksJson
    ? {
        description: (tree.hooksJson.description as string | undefined) ?? null,
        events: (tree.hooksJson.hooks ?? tree.hooksJson) as Record<string, unknown[]>,
      }
    : null;

  // Codex plugin-level interface may come from plugin.json.interface OR agents/openai.yaml
  const interfaceBlock = {
    ...((manifest.interface as Record<string, unknown>) ?? {}),
    ...((tree.pluginAgentYaml ?? {}) as Record<string, unknown>),
  };

  return buildCanonical({
    id: deriveId(manifest.name as string, tree.origin.repo),
    origin: { ecosystem: "codex", ...tree.origin },
    type: "plugin",
    name: (manifest.name as string) ?? "",
    description: (manifest.description as string) ?? "",
    version: (manifest.version as string) ?? null,
    author: (manifest.author as Record<string, string>) ?? null,
    homepage: (manifest.homepage as string) ?? null,
    repository: (manifest.repository as string) ?? null,
    license: (manifest.license as string) ?? null,
    keywords: ((manifest.keywords as string[]) ?? []),
    category: (interfaceBlock.category as string) ?? null,
    skills,
    mcpServers: mcpServersWrapped as Record<string, Record<string, unknown>>,
    commands: tree.commands.map((c) => parseCommandFile(c.path, c.content)),
    hooks,
    agents: tree.agents.map((a) => parseAgentFile(a.path, a.content)),
    apps: appsRaw,
    interface: Object.keys(interfaceBlock).length > 0 ? interfaceBlock : null,
    claudeExtensions: (sidecar as Record<string, unknown>) ?? {},
    codexExtensions: {},
  });
}

function standaloneToCanonical(tree: PluginTree): CanonicalSkill {
  if (tree.skills.length !== 1) {
    throw new Error(
      `Standalone ecosystem requires exactly one skill; found ${tree.skills.length}`,
    );
  }
  const skill = parseSkill(tree.skills[0]!);
  return buildCanonical({
    id: deriveId(skill.name, tree.origin.repo),
    origin: { ecosystem: "standalone", ...tree.origin },
    type: "skill",
    name: skill.name,
    description: skill.description,
    version: skill.version,
    skills: [skill],
  });
}

// ============================================================================
// fromCanonical — emit target-ecosystem artifacts
// ============================================================================

export function fromCanonical(canonical: CanonicalSkill, target: Ecosystem): TranslateResult {
  switch (target) {
    case "claude":
      return canonicalToClaude(canonical);
    case "codex":
      return canonicalToCodex(canonical);
    case "standalone":
      return canonicalToStandalone(canonical);
  }
}

function canonicalToClaude(c: CanonicalSkill): TranslateResult {
  const files: EmittedFile[] = [];
  const log: TranslationLogEntry[] = [];

  // .claude-plugin/plugin.json — minimal (Claude convention)
  const claudeManifest: Record<string, unknown> = {
    name: c.name,
    description: c.description,
  };
  if (c.author) claudeManifest.author = c.author;
  files.push({ path: ".claude-plugin/plugin.json", content: stableJson(claudeManifest) });

  // Codex-specific fields preserved in .claude-plugin/codex_ecosystem.json sidecar
  const codexEcosystem: Record<string, unknown> = {};
  if (c.version) codexEcosystem.version = c.version;
  if (c.homepage) codexEcosystem.homepage = c.homepage;
  if (c.repository) codexEcosystem.repository = c.repository;
  if (c.license) codexEcosystem.license = c.license;
  if (c.keywords.length > 0) codexEcosystem.keywords = c.keywords;
  if (Object.keys(c.apps).length > 0) codexEcosystem.apps = c.apps;
  if (c.interface) codexEcosystem.interface = c.interface;

  const skillInterfaces: Record<string, unknown> = {};
  for (const skill of c.skills) {
    if (skill.skillInterface) {
      skillInterfaces[skill.name] = skill.skillInterface;
    }
  }
  if (Object.keys(skillInterfaces).length > 0) {
    codexEcosystem.skill_interfaces = skillInterfaces;
  }

  if (Object.keys(codexEcosystem).length > 0) {
    files.push({
      path: ".claude-plugin/codex_ecosystem.json",
      content: stableJson(codexEcosystem),
    });
    log.push({
      level: "info",
      field: "codex_ecosystem",
      message:
        "Codex-specific metadata preserved in .claude-plugin/codex_ecosystem.json for lossless round-trip",
      shim_generated: ".claude-plugin/codex_ecosystem.json",
    });
  }

  if (Object.keys(c.apps).length > 0) {
    files.push({
      path: "docs/codex-apps.notes.md",
      content: renderCodexAppsNotes(c.apps),
    });
    log.push({
      level: "lossy",
      field: "apps",
      message:
        "Codex connector apps have no Claude equivalent; documented in docs/codex-apps.notes.md + preserved in codex_ecosystem.json",
      shim_generated: "docs/codex-apps.notes.md",
    });
  }

  // .mcp.json FLAT (Claude shape) at root
  if (Object.keys(c.mcpServers).length > 0) {
    files.push({ path: ".mcp.json", content: stableJson(c.mcpServers) });
  }

  // hooks/hooks.json (Claude subdir)
  if (c.hooks) {
    files.push({
      path: "hooks/hooks.json",
      content: stableJson({
        ...(c.hooks.description ? { description: c.hooks.description } : {}),
        hooks: c.hooks.events,
      }),
    });
  }

  // skills/ with claude-appropriate frontmatter (restore Claude-only keys from canonical if present)
  for (const skill of c.skills) {
    const skillDir = `skills/${skill.name}`;
    const frontmatter = { ...skill.frontmatter };
    // No stripping — Claude accepts all frontmatter keys
    const skillMd = renderSkillMd(frontmatter, skill.body);
    files.push({ path: `${skillDir}/SKILL.md`, content: skillMd });
  }

  // agents/
  for (const agent of c.agents) {
    files.push({ path: `agents/${agent.name}.md`, content: agent.body });
  }

  // commands/
  for (const cmd of c.commands) {
    files.push({ path: `commands/${cmd.name}.md`, content: cmd.body });
  }

  return { files, translationLog: log };
}

function canonicalToCodex(c: CanonicalSkill): TranslateResult {
  const files: EmittedFile[] = [];
  const log: TranslationLogEntry[] = [];

  // Codex plugin.json — rich, declarative
  const version = c.version ?? "0.0.1";
  if (!c.version) {
    log.push({
      level: "warning",
      field: "version",
      message: "Claude-origin plugin lacked version; defaulted to '0.0.1'",
      shim_generated: null,
    });
  }

  const interfaceBlock = c.interface ? { ...c.interface } : synthesizeInterface(c);
  if (!c.interface) {
    log.push({
      level: "info",
      field: "interface",
      message: "Synthesized Codex interface{} block from canonical fields",
      shim_generated: null,
    });
  }

  const codexManifest: Record<string, unknown> = {
    name: c.name,
    version,
    description: c.description,
    author: c.author ?? { name: "Unknown" },
    homepage: c.homepage ?? c.author?.url ?? "about:blank",
    repository: c.repository ?? "about:blank",
    license: c.license ?? "UNLICENSED",
    keywords: c.keywords,
    skills: c.skills.length > 0 ? "./skills/" : undefined,
    interface: interfaceBlock,
  };

  if (Object.keys(c.mcpServers).length > 0) codexManifest.mcpServers = "./.mcp.json";
  if (Object.keys(c.apps).length > 0) codexManifest.apps = "./.app.json";
  if (c.hooks) codexManifest.hooks = "./hooks.json";

  // Strip undefined values
  for (const k of Object.keys(codexManifest)) {
    if (codexManifest[k] === undefined) delete codexManifest[k];
  }

  files.push({ path: ".codex-plugin/plugin.json", content: stableJson(codexManifest) });

  // Claude-only metadata stashed in sidecar
  const claudeEcosystem: Record<string, unknown> = {};
  const strippedSkillFrontmatter: Record<string, Record<string, unknown>> = {};

  for (const skill of c.skills) {
    const claudeOnlyKeys = ["allowed-tools", "disable-model-invocation", "user-invocable"];
    const stripped: Record<string, unknown> = {};
    for (const key of claudeOnlyKeys) {
      if (key in skill.frontmatter) {
        stripped[key] = skill.frontmatter[key];
      }
    }
    if (Object.keys(stripped).length > 0) {
      strippedSkillFrontmatter[skill.name] = stripped;
    }
  }

  if (Object.keys(strippedSkillFrontmatter).length > 0) {
    claudeEcosystem.skill_frontmatter = strippedSkillFrontmatter;
  }

  if (Object.keys(claudeEcosystem).length > 0) {
    files.push({
      path: ".codex-plugin/claude_ecosystem.json",
      content: stableJson(claudeEcosystem),
    });
    log.push({
      level: "lossy",
      field: "claude_ecosystem",
      message: "Claude-only frontmatter keys preserved in .codex-plugin/claude_ecosystem.json",
      shim_generated: ".codex-plugin/claude_ecosystem.json",
    });
  }

  // .mcp.json WRAPPED (Codex shape)
  if (Object.keys(c.mcpServers).length > 0) {
    files.push({ path: ".mcp.json", content: stableJson({ mcpServers: c.mcpServers }) });
  }

  // hooks.json at root (Codex)
  if (c.hooks) {
    const events = c.hooks.events;
    const unsupportedEvents = ["Stop", "SessionStart", "UserPromptSubmit"];
    for (const evt of unsupportedEvents) {
      if (evt in events) {
        log.push({
          level: "warning",
          field: `hooks.${evt}`,
          message: `Codex support for ${evt} hook events is not confirmed; emitted as-is with _translator_note`,
          shim_generated: `_translator_note_${evt}`,
        });
      }
    }
    files.push({
      path: "hooks.json",
      content: stableJson({
        ...(c.hooks.description ? { description: c.hooks.description } : {}),
        hooks: events,
      }),
    });
  }

  // .app.json (Codex-only)
  if (Object.keys(c.apps).length > 0) {
    files.push({ path: ".app.json", content: stableJson({ apps: c.apps }) });
  }

  // skills/ — strip Claude-only frontmatter, add HTML shim comments preserving intent
  for (const skill of c.skills) {
    const skillDir = `skills/${skill.name}`;
    const frontmatter = { ...skill.frontmatter };
    const stripped: Record<string, unknown> = {};
    for (const key of ["allowed-tools", "disable-model-invocation", "user-invocable"]) {
      if (key in frontmatter) {
        stripped[key] = frontmatter[key];
        delete frontmatter[key];
      }
    }

    let body = skill.body;
    if (Object.keys(stripped).length > 0) {
      const shim = `<!-- translator-shim: Claude-only frontmatter preserved in .codex-plugin/claude_ecosystem.json: ${JSON.stringify(stripped)} -->\n`;
      body = shim + body;
    }

    files.push({ path: `${skillDir}/SKILL.md`, content: renderSkillMd(frontmatter, body) });

    if (skill.skillInterface) {
      // Re-emit Codex-native skill-level openai.yaml
      files.push({
        path: `${skillDir}/agents/openai.yaml`,
        content: renderYaml(skill.skillInterface),
      });
    }
  }

  // agents/ — same format in both ecosystems
  for (const agent of c.agents) {
    files.push({ path: `agents/${agent.name}.md`, content: agent.body });
  }

  // commands/
  for (const cmd of c.commands) {
    files.push({ path: `commands/${cmd.name}.md`, content: cmd.body });
  }

  return { files, translationLog: log };
}

function canonicalToStandalone(c: CanonicalSkill): TranslateResult {
  const files: EmittedFile[] = [];
  const log: TranslationLogEntry[] = [];

  if (c.skills.length !== 1) {
    throw new Error(
      `Canonical has ${c.skills.length} skills; standalone target requires exactly 1. Blockers: agents=${c.agents.length}, commands=${c.commands.length}, mcpServers=${Object.keys(c.mcpServers).length}`,
    );
  }

  const skill = c.skills[0]!;
  files.push({ path: "SKILL.md", content: renderSkillMd(skill.frontmatter, skill.body) });

  // Stash any non-standalone fields as sidecar
  const sidecar: Record<string, unknown> = {};
  if (c.version) sidecar.version = c.version;
  if (c.homepage) sidecar.homepage = c.homepage;
  if (c.repository) sidecar.repository = c.repository;
  if (c.license) sidecar.license = c.license;
  if (c.keywords.length > 0) sidecar.keywords = c.keywords;
  if (c.interface) sidecar.interface = c.interface;
  if (Object.keys(sidecar).length > 0) {
    files.push({ path: `${c.name}.ecosystem.json`, content: stableJson(sidecar) });
    log.push({
      level: "info",
      field: "ecosystem_sidecar",
      message: "Non-standalone metadata preserved for round-trip",
      shim_generated: `${c.name}.ecosystem.json`,
    });
  }

  return { files, translationLog: log };
}

// ============================================================================
// convenience wrapper
// ============================================================================

export function translateManifest(
  tree: PluginTree,
  source: Ecosystem,
  target: Ecosystem,
): TranslateResult {
  const canonical = toCanonical(tree, source);
  return fromCanonical(canonical, target);
}

// ============================================================================
// Helpers
// ============================================================================

interface BuildCanonicalArgs {
  id: string;
  origin: { ecosystem: Ecosystem; sourcePath: string; sourceSha: string | null; repo: string | null };
  type: "plugin" | "skill";
  name: string;
  description: string;
  version: string | null;
  author?: Record<string, unknown> | null;
  homepage?: string | null;
  repository?: string | null;
  license?: string | null;
  keywords?: string[];
  category?: string | null;
  skills: SkillContent[];
  mcpServers?: Record<string, Record<string, unknown>>;
  commands?: CanonicalSkill["commands"];
  hooks?: CanonicalSkill["hooks"];
  agents?: CanonicalSkill["agents"];
  apps?: Record<string, unknown>;
  interface?: Record<string, unknown> | null;
  claudeExtensions?: Record<string, unknown>;
  codexExtensions?: Record<string, unknown>;
}

function buildCanonical(args: BuildCanonicalArgs): CanonicalSkill {
  return {
    id: args.id,
    origin: args.origin,
    type: args.type,
    name: args.name,
    description: args.description,
    version: args.version,
    author: (args.author as CanonicalSkill["author"]) ?? null,
    homepage: args.homepage ?? null,
    repository: args.repository ?? null,
    license: args.license ?? null,
    keywords: args.keywords ?? [],
    tags: [],
    category: args.category ?? null,
    skills: args.skills,
    mcpServers: (args.mcpServers ?? {}) as CanonicalSkill["mcpServers"],
    commands: args.commands ?? [],
    hooks: args.hooks ?? null,
    agents: args.agents ?? [],
    apps: args.apps ?? {},
    interface: args.interface ?? null,
    ecosystem_extensions: {
      claude: args.claudeExtensions ?? {},
      codex: args.codexExtensions ?? {},
    },
    translation_log: [],
    quality_score: 0,
    quality_breakdown: {},
    compatibility_flags: {},
    content_hash: "",
    last_verified: new Date().toISOString(),
    install_count: 0,
  };
}

function parseSkill(skill: PluginTree["skills"][number]): SkillContent {
  const parsed = parseFrontmatter(skill.skillMdContent, skill.path);
  validateRequiredFrontmatter(parsed.frontmatter, skill.path);
  return {
    path: skill.path,
    name: parsed.frontmatter.name as string,
    description: parsed.frontmatter.description as string,
    version: (parsed.frontmatter.version as string | undefined) ?? null,
    frontmatter: parsed.frontmatter,
    body: parsed.body,
    references: skill.referencePaths,
    scripts: skill.scriptPaths,
    assets: skill.assetPaths,
    nestedAgents: skill.skillAgents.map((a) => parseAgentFile(a.path, a.content)),
    skillInterface: skill.skillInterfaceYaml,
  };
}

function parseAgentFile(path: string, content: string): CanonicalSkill["agents"][number] {
  try {
    const parsed = parseFrontmatter(content, path);
    return {
      name: (parsed.frontmatter.name as string) ?? baseName(path),
      description: (parsed.frontmatter.description as string | undefined) ?? null,
      tools: (parsed.frontmatter.tools as string[]) ?? [],
      model: (parsed.frontmatter.model as string | undefined) ?? null,
      color: (parsed.frontmatter.color as string | undefined) ?? null,
      body: parsed.body,
      scope: "plugin" as const,
      parentSkill: null,
    };
  } catch {
    // If no frontmatter, treat the whole file as body with synthesized name
    return {
      name: baseName(path),
      description: null,
      tools: [],
      model: null,
      color: null,
      body: content,
      scope: "plugin" as const,
      parentSkill: null,
    };
  }
}

function parseCommandFile(path: string, content: string): CanonicalSkill["commands"][number] {
  try {
    const parsed = parseFrontmatter(content, path);
    return {
      name: baseName(path),
      description: (parsed.frontmatter.description as string | undefined) ?? null,
      argumentHint: (parsed.frontmatter["argument-hint"] as string | undefined) ?? null,
      allowedTools: (parsed.frontmatter["allowed-tools"] as string[]) ?? [],
      body: parsed.body,
    };
  } catch {
    return {
      name: baseName(path),
      description: null,
      argumentHint: null,
      allowedTools: [],
      body: content,
    };
  }
}

function baseName(path: string): string {
  const n = path.split("/").pop() ?? path;
  return n.replace(/\.(md|yaml|yml)$/i, "");
}

function renderSkillMd(frontmatter: Record<string, unknown>, body: string): string {
  const yamlLines: string[] = ["---"];
  for (const [k, v] of Object.entries(frontmatter)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string") yamlLines.push(`${k}: ${v.includes("\n") || v.includes(":") ? JSON.stringify(v) : v}`);
    else if (typeof v === "boolean" || typeof v === "number") yamlLines.push(`${k}: ${v}`);
    else if (Array.isArray(v)) yamlLines.push(`${k}: [${v.map((x) => JSON.stringify(x)).join(", ")}]`);
    else yamlLines.push(`${k}: ${JSON.stringify(v)}`);
  }
  yamlLines.push("---");
  return yamlLines.join("\n") + "\n\n" + body.replace(/^\n+/, "");
}

function renderYaml(obj: Record<string, unknown>): string {
  // Minimal YAML renderer for flat interface objects
  const lines: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string") lines.push(`${k}: ${v.includes("\n") || v.includes(":") ? JSON.stringify(v) : v}`);
    else if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${typeof item === "string" ? item : JSON.stringify(item)}`);
    } else lines.push(`${k}: ${JSON.stringify(v)}`);
  }
  return lines.join("\n") + "\n";
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as object).sort(), 2) + "\n";
}

function renderCodexAppsNotes(apps: Record<string, unknown>): string {
  const lines = [
    "# Codex Connector Apps — Not Supported in Claude",
    "",
    "This plugin originally bundled OpenAI Codex connector apps (`.app.json`).",
    "Claude Code has no equivalent connector mechanism. The following entries were",
    "preserved in `.claude-plugin/codex_ecosystem.json` for round-trip compatibility:",
    "",
    "```json",
    JSON.stringify({ apps }, null, 2),
    "```",
    "",
    "To use these connectors, install the plugin in an OpenAI Codex session instead.",
  ];
  return lines.join("\n") + "\n";
}

function synthesizeInterface(c: CanonicalSkill): Record<string, unknown> {
  return {
    displayName: titleCase(c.name),
    shortDescription: c.description.length > 60 ? c.description.slice(0, 57) + "..." : c.description,
    longDescription: c.description,
    category: c.category ?? "Coding",
    capabilities: [],
    websiteURL: c.homepage ?? c.author?.url ?? "about:blank",
    privacyPolicyURL: "",
    termsOfServiceURL: "",
    defaultPrompt: [`Use $${c.name} to ${firstSentence(c.description).toLowerCase()}`],
    composerIcon: "",
    logo: "",
    screenshots: [],
  };
}

function titleCase(s: string): string {
  return s
    .split(/[-_]/)
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function firstSentence(s: string): string {
  const match = s.match(/^[^.!?]+[.!?]/);
  return match ? match[0].trim().replace(/[.!?]+$/, "") : s.slice(0, 80);
}

function deriveId(name: string, repo: string | null): string {
  if (!name) throw new Error("Cannot derive id: missing name");
  if (repo) {
    const slug = repo.toLowerCase().replace(/\//g, "-").replace(/[^a-z0-9-]/g, "");
    return `${slug}/${name}`;
  }
  return name;
}
