/**
 * Quality scorer — 0-100 deterministic score for a CanonicalSkill.
 * Rubric matches references/09-quality-scoring-rubric.md.
 *
 * Rules (each adds points when the condition holds):
 *   has_references       >=2 references         +10
 *   has_scripts          >=1 script             +10
 *   description_quality  len>=100 + trigger     +5 (3 for len-only)
 *   has_examples         body has ## Example[s] +10
 *   passes_validation    frontmatter complete   +20
 *   star_weight          log10(stars) * 10      0-25
 *   has_tests            script named test/...  +20
 *
 * Max possible: 100. Scores are deterministic.
 */
import type { CanonicalSkill } from "@blazesportsintel/universal-skills-schema";

export interface QualityBreakdown {
  has_references: number;
  has_scripts: number;
  description_quality: number;
  has_examples: number;
  passes_validation: number;
  star_weight: number;
  has_tests: number;
}

export interface QualityScore {
  total: number;
  breakdown: QualityBreakdown;
  grade: "A" | "B" | "C" | "D" | "F";
}

export function scoreSkill(canonical: CanonicalSkill, starCount = 0): QualityScore {
  const breakdown: QualityBreakdown = {
    has_references: 0,
    has_scripts: 0,
    description_quality: 0,
    has_examples: 0,
    passes_validation: 0,
    star_weight: 0,
    has_tests: 0,
  };

  const primary = canonical.skills[0];
  const refs = primary?.references ?? [];
  const scripts = primary?.scripts ?? [];
  const body = primary?.body ?? "";

  if (refs.length >= 2) breakdown.has_references = 10;
  if (scripts.length >= 1) breakdown.has_scripts = 10;

  if (canonical.description.length >= 100) {
    const desc = canonical.description.toLowerCase();
    const hasTrigger =
      desc.includes("use when") ||
      desc.includes("triggers on") ||
      desc.includes("triggers when") ||
      desc.includes("trigger on") ||
      desc.includes("when the user");
    breakdown.description_quality = hasTrigger ? 5 : 3;
  }

  if (/^##\s+Examples?\b/im.test(body)) {
    breakdown.has_examples = 10;
  }

  const fm = primary?.frontmatter ?? {};
  if (
    canonical.name &&
    canonical.description &&
    typeof fm.name === "string" &&
    typeof fm.description === "string"
  ) {
    breakdown.passes_validation = 20;
  } else if (canonical.name && canonical.description) {
    breakdown.passes_validation = 10; // partial credit for canonical-only
  }

  if (starCount > 0) {
    breakdown.star_weight = Math.min(25, Math.floor(Math.log10(Math.max(starCount, 1)) * 10));
  }

  const hasTests = scripts.some((path) => {
    const filename = path.split("/").pop() ?? "";
    return /^(test|validate|verify)/i.test(filename);
  });
  if (hasTests) breakdown.has_tests = 20;

  const total = Math.min(
    100,
    Object.values(breakdown).reduce((sum, v) => sum + v, 0),
  );
  const grade =
    total >= 85 ? "A" : total >= 70 ? "B" : total >= 50 ? "C" : total >= 30 ? "D" : "F";

  return { total, breakdown, grade };
}
