import { describe, it, expect } from "vitest";
import {
  parseFrontmatter,
  validateRequiredFrontmatter,
  extractTriggerKeywords,
  serializeFrontmatter,
} from "../../src/lib/frontmatter.js";
import { InvalidFrontmatterError, YAMLParseError } from "../../src/errors.js";

describe("parseFrontmatter", () => {
  it("parses valid SKILL.md with name + description", () => {
    const content = `---
name: test-skill
description: A test skill
version: 0.1.0
---

# Test Skill

Body here.`;
    const parsed = parseFrontmatter(content, "SKILL.md");
    expect(parsed.frontmatter.name).toBe("test-skill");
    expect(parsed.frontmatter.description).toBe("A test skill");
    expect(parsed.frontmatter.version).toBe("0.1.0");
    expect(parsed.body).toContain("Test Skill");
  });

  it("strips UTF-8 BOM if present", () => {
    const content = "\uFEFF---\nname: bom\ndescription: ok\n---\n\nbody";
    const parsed = parseFrontmatter(content);
    expect(parsed.frontmatter.name).toBe("bom");
  });

  it("throws InvalidFrontmatterError when --- block absent", () => {
    const content = "# Just a heading\n\nNo frontmatter.";
    expect(() => parseFrontmatter(content, "bad.md")).toThrow(InvalidFrontmatterError);
  });

  it("throws YAMLParseError on malformed YAML", () => {
    const content = `---
name: invalid
description: |
  unclosed [
---

body`;
    expect(() => parseFrontmatter(content)).toThrow(YAMLParseError);
  });

  it("throws InvalidFrontmatterError on empty frontmatter", () => {
    const content = "---\n---\n\nbody";
    expect(() => parseFrontmatter(content)).toThrow(InvalidFrontmatterError);
  });
});

describe("validateRequiredFrontmatter", () => {
  it("accepts complete frontmatter", () => {
    expect(() =>
      validateRequiredFrontmatter({ name: "x", description: "y" }),
    ).not.toThrow();
  });

  it("throws when name missing", () => {
    expect(() => validateRequiredFrontmatter({ description: "y" })).toThrow(InvalidFrontmatterError);
  });

  it("throws when description missing", () => {
    expect(() => validateRequiredFrontmatter({ name: "x" })).toThrow(InvalidFrontmatterError);
  });

  it("throws when description is empty string", () => {
    expect(() => validateRequiredFrontmatter({ name: "x", description: "" })).toThrow(
      InvalidFrontmatterError,
    );
  });
});

describe("extractTriggerKeywords", () => {
  it("extracts quoted triggers", () => {
    const triggers = extractTriggerKeywords(
      "Triggers on 'pdf processing', \"form filling\", `extraction`.",
    );
    expect(triggers).toEqual(["pdf processing", "form filling", "extraction"]);
  });

  it("extracts use-when clause", () => {
    const triggers = extractTriggerKeywords("Use when processing large PDFs.");
    expect(triggers.some((t) => t.includes("processing large pdfs"))).toBe(true);
  });

  it("returns empty array when no triggers found", () => {
    expect(extractTriggerKeywords("A generic description.")).toEqual([]);
  });
});

describe("serializeFrontmatter", () => {
  it("round-trips through parse", () => {
    const fm = { name: "rt", description: "round trip", version: "0.1.0" };
    const serialized = serializeFrontmatter(fm, "# Body\n\nContent");
    const parsed = parseFrontmatter(serialized);
    expect(parsed.frontmatter.name).toBe("rt");
    expect(parsed.frontmatter.description).toBe("round trip");
  });
});
