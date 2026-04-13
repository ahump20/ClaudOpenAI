/**
 * Frontmatter parser — gray-matter wrapper with typed errors and safe defaults.
 * Used by translator and indexer to extract SKILL.md frontmatter.
 */
import matter from "gray-matter";
import { InvalidFrontmatterError, YAMLParseError } from "../errors.js";

export interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>;
  body: string;
  raw: string;
}

/**
 * Parse a SKILL.md / plugin markdown file into frontmatter + body.
 * Throws InvalidFrontmatterError if no --- delimited block is present.
 * Throws YAMLParseError on YAML syntax errors.
 */
export function parseFrontmatter(content: string, path?: string): ParsedFrontmatter {
  const trimmed = content.replace(/^\uFEFF/, ""); // strip UTF-8 BOM
  if (!trimmed.startsWith("---")) {
    throw new InvalidFrontmatterError(
      "No YAML frontmatter found in SKILL.md",
      { path: path ?? "<unknown>" },
    );
  }

  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(trimmed);
  } catch (err) {
    throw new YAMLParseError(
      `Failed to parse YAML frontmatter: ${err instanceof Error ? err.message : String(err)}`,
      { path: path ?? "<unknown>", cause: err instanceof Error ? err.message : undefined },
    );
  }

  if (!parsed.data || typeof parsed.data !== "object") {
    throw new InvalidFrontmatterError(
      "Frontmatter block is empty or not an object",
      { path: path ?? "<unknown>" },
    );
  }

  return {
    frontmatter: parsed.data as Record<string, unknown>,
    body: parsed.content,
    raw: trimmed,
  };
}

/**
 * Serialize a frontmatter + body pair back to SKILL.md form.
 * Used by the translator on emission.
 */
export function serializeFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
  return matter.stringify(body, frontmatter);
}

/**
 * Validate a frontmatter object has the minimum agentskills.io-standard keys.
 */
export function validateRequiredFrontmatter(
  frontmatter: Record<string, unknown>,
  path?: string,
): void {
  if (typeof frontmatter.name !== "string" || !frontmatter.name) {
    throw new InvalidFrontmatterError("frontmatter missing required 'name'", { path });
  }
  if (typeof frontmatter.description !== "string" || !frontmatter.description) {
    throw new InvalidFrontmatterError("frontmatter missing required 'description'", { path });
  }
}

/**
 * Extract trigger keywords from a description string.
 * Matches patterns like "Triggers on 'X', 'Y'" or "Use when X".
 */
export function extractTriggerKeywords(description: string): string[] {
  const triggers: string[] = [];
  const tripMatch = description.match(/triggers?\s+on\s+(.+?)(?:\.\s|$)/i);
  if (tripMatch?.[1]) {
    const list = tripMatch[1];
    const quoted = list.matchAll(/"([^"]+)"|'([^']+)'|`([^`]+)`/g);
    for (const q of quoted) {
      const term = q[1] ?? q[2] ?? q[3];
      if (term) triggers.push(term.toLowerCase());
    }
  }
  const useMatch = description.match(/use\s+when\s+([^.]+)/i);
  if (useMatch?.[1]) {
    triggers.push(useMatch[1].trim().toLowerCase());
  }
  return triggers;
}
