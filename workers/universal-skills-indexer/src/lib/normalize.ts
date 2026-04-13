/**
 * Minimal normalizer — converts an upstream file to a canonical record.
 * For v0.1, we accept lossy parsing (no gray-matter bundle) and use a regex-based
 * frontmatter extractor. Good enough to drive D1 + R2 metadata.
 */
import type { UpstreamSource } from "../sources.js";

export interface CanonicalRecord {
  id: string;
  name: string;
  description: string;
  source_ecosystem: "claude" | "codex" | "universal";
  source_url: string;
  source_repo: string;
  source_commit: string;
  source_path: string;
  manifest_format: "claude-plugin" | "codex-plugin" | "standalone-skill" | "openai-agent";
  quality_score: number;
  content_hash: string;
  compat_claude: 0 | 1;
  compat_codex: 0 | 1;
  tags: string; // JSON array as string
  category: string | null;
  version: string | null;
  body: string;
}

export async function normalizeFile(
  src: UpstreamSource,
  filePath: string,
  content: string,
  commit: string,
): Promise<CanonicalRecord | null> {
  const contentHash = await sha256Hex(content);

  if (filePath.endsWith("/SKILL.md")) {
    return normalizeSkillMd(src, filePath, content, commit, contentHash);
  }

  if (filePath.endsWith("plugin.json")) {
    return normalizePluginJson(src, filePath, content, commit, contentHash);
  }

  // marketplace.json files aren't individual skills — skip for now
  return null;
}

function normalizeSkillMd(
  src: UpstreamSource,
  filePath: string,
  content: string,
  commit: string,
  contentHash: string,
): CanonicalRecord | null {
  const fm = extractYamlFrontmatter(content);
  if (!fm || typeof fm.name !== "string" || typeof fm.description !== "string") return null;

  const name = fm.name;
  const description = fm.description;
  const skillDirName = filePath.replace(/\/SKILL\.md$/, "").split("/").pop() ?? name;

  const quality = computeQualityLite(content);
  const ecosystem = detectEcosystem(filePath, src.name);

  return {
    id: `${src.name.toLowerCase().replace(/\//g, "-")}/${skillDirName}`,
    name: skillDirName,
    description,
    source_ecosystem: ecosystem,
    source_url: `https://github.com/${src.name}/blob/${commit}/${filePath}`,
    source_repo: src.name,
    source_commit: commit,
    source_path: filePath,
    manifest_format: src.manifest_hint === "openai-agent" ? "openai-agent" : "standalone-skill",
    quality_score: quality,
    content_hash: contentHash,
    compat_claude: 1,
    compat_codex: 1,
    tags: JSON.stringify([name]),
    category: null,
    version: (fm.version as string | undefined) ?? null,
    body: extractBody(content),
  };
}

function normalizePluginJson(
  src: UpstreamSource,
  filePath: string,
  content: string,
  commit: string,
  contentHash: string,
): CanonicalRecord | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof parsed.name !== "string" || typeof parsed.description !== "string") return null;

  const isCodex = filePath.includes("/.codex-plugin/");
  const name = parsed.name;
  const description = parsed.description;

  return {
    id: `${src.name.toLowerCase().replace(/\//g, "-")}/${name}`,
    name,
    description,
    source_ecosystem: isCodex ? "codex" : "claude",
    source_url: `https://github.com/${src.name}/blob/${commit}/${filePath}`,
    source_repo: src.name,
    source_commit: commit,
    source_path: filePath,
    manifest_format: isCodex ? "codex-plugin" : "claude-plugin",
    quality_score: 50, // plugin metadata alone earns a middle score
    content_hash: contentHash,
    compat_claude: isCodex ? 0 : 1,
    compat_codex: isCodex ? 1 : 0,
    tags: JSON.stringify(Array.isArray(parsed.keywords) ? parsed.keywords : []),
    category:
      parsed.interface && typeof parsed.interface === "object"
        ? ((parsed.interface as Record<string, unknown>).category as string | undefined) ?? null
        : null,
    version: (parsed.version as string | undefined) ?? null,
    body: "",
  };
}

function extractYamlFrontmatter(content: string): Record<string, unknown> | null {
  const stripped = content.replace(/^\uFEFF/, "");
  const match = stripped.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const yamlBlock = match[1]!;
  const obj: Record<string, unknown> = {};
  for (const rawLine of yamlBlock.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    let value: string = line.slice(colonIdx + 1).trim();
    // Strip matching surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    obj[key] = value;
  }
  return obj;
}

function extractBody(content: string): string {
  const stripped = content.replace(/^\uFEFF/, "");
  const match = stripped.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  return match ? match[1]!.trim() : stripped;
}

function computeQualityLite(content: string): number {
  // Worker-local lite scorer. Full scorer lives in packages/mcp-server.
  // Checks that cost nothing in a string-only context:
  //   - has frontmatter with name + description
  //   - description length
  //   - has ## Example heading
  let score = 0;
  const fm = extractYamlFrontmatter(content);
  if (fm?.name && fm.description) score += 20;
  if (typeof fm?.description === "string" && fm.description.length >= 100) {
    const desc = fm.description.toLowerCase();
    score += desc.includes("use when") || desc.includes("triggers on") ? 5 : 3;
  }
  if (/^##\s+Examples?\b/im.test(content)) score += 10;
  return score;
}

function detectEcosystem(filePath: string, sourceRepo: string): "claude" | "codex" | "universal" {
  if (filePath.includes("/.claude-plugin/")) return "claude";
  if (filePath.includes("/.codex-plugin/")) return "codex";
  if (sourceRepo.includes("openai/")) return "codex";
  if (sourceRepo.includes("anthropics/")) return "claude";
  return "universal";
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
