import { describe, it, expect } from "vitest";
import { toCanonical, fromCanonical, translateManifest } from "../../src/lib/translator.js";
import type { PluginTree } from "../../src/lib/translator.js";

const CLAUDE_TREE: PluginTree = {
  manifestJson: {
    name: "test-plugin",
    description: "A test Claude plugin",
    author: { name: "Test Author", email: "test@example.com" },
  },
  mcpJson: {
    myserver: { command: "npx", args: ["-y", "somepkg"] },
  },
  appJson: null,
  hooksJson: null,
  pluginAgentYaml: null,
  claudeSidecarEcosystem: null,
  codexSidecarEcosystem: null,
  skills: [
    {
      path: "skills/test-skill",
      skillMdContent: `---
name: test-skill
description: Use when testing. Triggers on 'test'.
allowed-tools: [Read, Edit]
---

# Test Skill

## Examples

Example 1`,
      referencePaths: ["references/00-intro.md"],
      scriptPaths: ["scripts/validate.sh"],
      assetPaths: [],
      skillAgents: [],
      skillInterfaceYaml: null,
    },
  ],
  agents: [],
  commands: [],
  origin: { sourcePath: "/tmp/test", sourceSha: null, repo: "test/repo" },
};

const CODEX_TREE: PluginTree = {
  manifestJson: {
    name: "codex-plugin",
    version: "1.0.0",
    description: "A test Codex plugin",
    author: { name: "Codex Author", url: "https://example.com" },
    homepage: "https://example.com",
    repository: "https://github.com/test/codex",
    license: "MIT",
    keywords: ["test"],
    skills: "./skills/",
    interface: {
      displayName: "Codex Plugin",
      shortDescription: "short",
      longDescription: "longer",
      category: "Coding",
      capabilities: ["Read"],
      websiteURL: "https://example.com",
      privacyPolicyURL: "",
      termsOfServiceURL: "",
      defaultPrompt: ["Use $codex-plugin"],
      composerIcon: "",
      logo: "",
      screenshots: [],
    },
  },
  mcpJson: null,
  appJson: { apps: { test: { id: "connector_test" } } },
  hooksJson: null,
  pluginAgentYaml: null,
  claudeSidecarEcosystem: null,
  codexSidecarEcosystem: null,
  skills: [
    {
      path: "skills/codex-skill",
      skillMdContent: `---
name: codex-skill
description: Use when in codex.
---

body`,
      referencePaths: [],
      scriptPaths: [],
      assetPaths: [],
      skillAgents: [],
      skillInterfaceYaml: null,
    },
  ],
  agents: [],
  commands: [],
  origin: { sourcePath: "/tmp/codex", sourceSha: null, repo: "test/codex" },
};

describe("toCanonical", () => {
  it("parses Claude plugin tree", () => {
    const canonical = toCanonical(CLAUDE_TREE, "claude");
    expect(canonical.name).toBe("test-plugin");
    expect(canonical.description).toBe("A test Claude plugin");
    expect(canonical.origin.ecosystem).toBe("claude");
    expect(canonical.skills).toHaveLength(1);
    expect(canonical.skills[0]!.name).toBe("test-skill");
    expect(canonical.skills[0]!.frontmatter["allowed-tools"]).toEqual(["Read", "Edit"]);
  });

  it("parses Codex plugin tree with interface + apps", () => {
    const canonical = toCanonical(CODEX_TREE, "codex");
    expect(canonical.name).toBe("codex-plugin");
    expect(canonical.version).toBe("1.0.0");
    expect(canonical.license).toBe("MIT");
    expect(canonical.apps).toEqual({ test: { id: "connector_test" } });
    expect(canonical.interface?.category).toBe("Coding");
  });
});

describe("fromCanonical → claude", () => {
  it("emits minimal .claude-plugin/plugin.json", () => {
    const canonical = toCanonical(CLAUDE_TREE, "claude");
    const result = fromCanonical(canonical, "claude");
    const plugin = result.files.find((f) => f.path === ".claude-plugin/plugin.json");
    expect(plugin).toBeDefined();
    const parsed = JSON.parse(plugin!.content);
    expect(parsed.name).toBe("test-plugin");
    expect(parsed.description).toBe("A test Claude plugin");
    // Claude manifest should NOT include Codex-only fields
    expect(parsed.mcpServers).toBeUndefined();
    expect(parsed.interface).toBeUndefined();
  });

  it("emits FLAT .mcp.json for Claude", () => {
    const canonical = toCanonical(CLAUDE_TREE, "claude");
    const result = fromCanonical(canonical, "claude");
    const mcp = result.files.find((f) => f.path === ".mcp.json");
    expect(mcp).toBeDefined();
    const parsed = JSON.parse(mcp!.content);
    expect(parsed.myserver).toBeDefined();
    expect(parsed.mcpServers).toBeUndefined(); // NOT wrapped
  });
});

describe("fromCanonical → codex", () => {
  it("emits full .codex-plugin/plugin.json with interface", () => {
    const canonical = toCanonical(CLAUDE_TREE, "claude");
    const result = fromCanonical(canonical, "codex");
    const plugin = result.files.find((f) => f.path === ".codex-plugin/plugin.json");
    expect(plugin).toBeDefined();
    const parsed = JSON.parse(plugin!.content);
    expect(parsed.name).toBe("test-plugin");
    expect(parsed.version).toBeDefined(); // synthesized
    expect(parsed.interface).toBeDefined();
    expect(parsed.interface.displayName).toBeDefined();
    expect(parsed.keywords).toEqual([]);
  });

  it("emits WRAPPED .mcp.json for Codex", () => {
    const canonical = toCanonical(CLAUDE_TREE, "claude");
    const result = fromCanonical(canonical, "codex");
    const mcp = result.files.find((f) => f.path === ".mcp.json");
    expect(mcp).toBeDefined();
    const parsed = JSON.parse(mcp!.content);
    expect(parsed.mcpServers).toBeDefined();
    expect(parsed.mcpServers.myserver).toBeDefined();
  });

  it("preserves Claude-only frontmatter in claude_ecosystem sidecar", () => {
    const canonical = toCanonical(CLAUDE_TREE, "claude");
    const result = fromCanonical(canonical, "codex");
    const sidecar = result.files.find((f) => f.path === ".codex-plugin/claude_ecosystem.json");
    expect(sidecar).toBeDefined();
    const parsed = JSON.parse(sidecar!.content);
    expect(parsed.skill_frontmatter["test-skill"]["allowed-tools"]).toEqual(["Read", "Edit"]);
  });

  it("logs lossy transformation for allowed-tools", () => {
    const canonical = toCanonical(CLAUDE_TREE, "claude");
    const result = fromCanonical(canonical, "codex");
    const lossyLogs = result.translationLog.filter((l) => l.level === "lossy");
    expect(lossyLogs.length).toBeGreaterThan(0);
  });
});

describe("translateManifest roundtrip", () => {
  it("Claude → Codex preserves core fields", () => {
    const result = translateManifest(CLAUDE_TREE, "claude", "codex");
    expect(result.files.length).toBeGreaterThan(0);
    const plugin = JSON.parse(
      result.files.find((f) => f.path === ".codex-plugin/plugin.json")!.content,
    );
    expect(plugin.name).toBe("test-plugin");
  });

  it("Codex → Claude preserves Codex metadata in sidecar", () => {
    const result = translateManifest(CODEX_TREE, "codex", "claude");
    const ecosystem = result.files.find(
      (f) => f.path === ".claude-plugin/codex_ecosystem.json",
    );
    expect(ecosystem).toBeDefined();
    const parsed = JSON.parse(ecosystem!.content);
    expect(parsed.version).toBe("1.0.0");
    expect(parsed.license).toBe("MIT");
    expect(parsed.apps).toBeDefined();
  });

  it("Codex → Claude emits docs/codex-apps.notes.md shim for connector apps", () => {
    const result = translateManifest(CODEX_TREE, "codex", "claude");
    const notes = result.files.find((f) => f.path === "docs/codex-apps.notes.md");
    expect(notes).toBeDefined();
    expect(notes!.content).toContain("connector");
    const lossyLog = result.translationLog.find((l) => l.field === "apps" && l.level === "lossy");
    expect(lossyLog).toBeDefined();
    expect(lossyLog!.shim_generated).toBe("docs/codex-apps.notes.md");
  });
});
