import { describe, it, expect } from "vitest";
import { scoreSkill } from "../../src/lib/scorer.js";
import type { CanonicalSkill } from "@blazesportsintel/universal-skills-schema";

function mkCanonical(overrides: Partial<CanonicalSkill> = {}): CanonicalSkill {
  const base: CanonicalSkill = {
    id: "test/skill",
    origin: { ecosystem: "standalone", sourcePath: ".", sourceSha: null, repo: null },
    type: "skill",
    name: "skill",
    description: "",
    version: null,
    author: null,
    homepage: null,
    repository: null,
    license: null,
    keywords: [],
    tags: [],
    category: null,
    skills: [],
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
  return { ...base, ...overrides };
}

function mkSkill(opts: {
  body?: string;
  references?: string[];
  scripts?: string[];
  frontmatter?: Record<string, unknown>;
}) {
  return {
    path: ".",
    name: "skill",
    description: "desc",
    version: null,
    frontmatter: opts.frontmatter ?? { name: "skill", description: "desc" },
    body: opts.body ?? "",
    references: opts.references ?? [],
    scripts: opts.scripts ?? [],
    assets: [],
    nestedAgents: [],
    skillInterface: null,
  };
}

describe("scoreSkill", () => {
  it("prompt-line-147 invariant: PDF-style high-quality skill scores >= 70", () => {
    const c = mkCanonical({
      name: "pdf",
      description:
        "Use when processing, extracting, or generating PDF documents. Triggers on 'pdf', 'pdf extract', 'pdf fill form'. Covers extraction, parsing, generation.",
      skills: [
        mkSkill({
          body: "# PDF\n\n## Examples\n\n### Example 1\n\ntext extraction",
          references: [
            "references/01-extraction.md",
            "references/02-forms.md",
            "references/03-generation.md",
            "references/04-tables.md",
          ],
          scripts: ["scripts/validate.sh", "scripts/test-extraction.py", "scripts/extract-cli.py"],
          frontmatter: { name: "pdf", description: "Use when processing PDFs" },
        }),
      ],
    });
    const score = scoreSkill(c, 16679); // openai/skills star count
    expect(score.total).toBeGreaterThanOrEqual(70);
    expect(score.grade).toBe("B"); // or A
  });

  it("empty stub scores under 30", () => {
    const c = mkCanonical({
      name: "stub",
      description: "does stuff",
      skills: [mkSkill({ frontmatter: { name: "stub", description: "does stuff" } })],
    });
    const score = scoreSkill(c, 0);
    expect(score.total).toBeLessThan(30);
    expect(score.grade).toBe("F");
  });

  it("is deterministic — same input, same score", () => {
    const c = mkCanonical({
      name: "det",
      description:
        "Use when X is needed. Triggers on 'X'. This is a deterministic test vector with sufficient length.",
      skills: [
        mkSkill({
          body: "# Det\n\n## Examples\n\nfoo",
          references: ["a.md", "b.md"],
          scripts: ["validate.sh"],
          frontmatter: { name: "det", description: "Use when X" },
        }),
      ],
    });
    const s1 = scoreSkill(c, 1000);
    const s2 = scoreSkill(c, 1000);
    expect(s1).toEqual(s2);
  });

  it("breakdown sums to total (or clamped at 100)", () => {
    const c = mkCanonical({
      name: "mx",
      description:
        "Use when doing something. Triggers on 'mx'. Long enough description to hit that rule.",
      skills: [
        mkSkill({
          body: "## Examples\nfoo",
          references: ["a.md", "b.md"],
          scripts: ["validate.sh", "test.sh"],
          frontmatter: { name: "mx", description: "Use when" },
        }),
      ],
    });
    const s = scoreSkill(c, 10_000);
    const sum = Object.values(s.breakdown).reduce((a, b) => a + b, 0);
    expect(s.total).toBe(Math.min(100, sum));
  });

  it("star weight is bounded at 25 even for giant star counts", () => {
    const c = mkCanonical({ skills: [mkSkill({ frontmatter: { name: "a", description: "b" } })] });
    const s = scoreSkill(c, 1_000_000);
    expect(s.breakdown.star_weight).toBeLessThanOrEqual(25);
  });

  it("grade letter correctly maps from total", () => {
    const low = scoreSkill(mkCanonical(), 0);
    expect(low.grade).toBe("F");
  });
});
