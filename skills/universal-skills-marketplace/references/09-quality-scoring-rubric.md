# 09 — Quality Scoring Rubric

0-100 score assigned to every indexed skill. Drives `resolve-skill` ranking (blended with FTS BM25) and filter thresholds. Per source prompt lines 45-46 + the verification constraint at line 147 (PDF skill from openai/skills must score ≥70).

## Design goals

1. **Deterministic.** Same canonical → same score, always. Enables regression testing.
2. **Transparent.** Every score comes with a breakdown: `{ total, rules: { has_references: 10, ... }}` — users + devs can see why.
3. **Additive.** Rules sum to 100 when all triggered. No multiplicative penalties (easy to reason about).
4. **Bounded.** Never exceeds 100. Missing most rules → 0. Typical real skill: 50-80.
5. **Cheap.** Pure function of canonical JSON + optional repo star count. No external calls during scoring.

## Scoring rules (each adds points when the condition holds)

| Rule | Condition | Points |
|------|-----------|--------|
| `has_references` | `canonical.skills[0].references.length >= 2` | +10 |
| `has_scripts` | `canonical.skills[0].scripts.length >= 1` | +10 |
| `description_quality` | `canonical.description.length >= 100` AND includes one trigger keyword | +5 |
| `has_examples` | body contains `## Example` OR `## Examples` section | +10 |
| `passes_validation` | frontmatter valid YAML, required keys present, name matches dir | +20 |
| `star_weight` | `min(25, floor(log10(star_count) * 10))` | 0-25 |
| `has_tests` | `canonical.skills[0].scripts` contains `test-*` or `validate*` | +20 |

Max possible: 10 + 10 + 5 + 10 + 20 + 25 + 20 = **100**.

## Implementation

```ts
// packages/mcp-server/src/lib/scorer.ts
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

export function scoreSkill(c: CanonicalSkill, starCount = 0): QualityScore {
  const b: QualityBreakdown = {
    has_references: 0,
    has_scripts: 0,
    description_quality: 0,
    has_examples: 0,
    passes_validation: 0,
    star_weight: 0,
    has_tests: 0,
  };

  // Pick the primary skill (first one, or the plugin itself if no skills)
  const primarySkill = c.skills[0] || { references: [], scripts: [], body: "", frontmatter: {} };

  // Rule: has_references
  if (primarySkill.references && primarySkill.references.length >= 2) {
    b.has_references = 10;
  }

  // Rule: has_scripts
  if (primarySkill.scripts && primarySkill.scripts.length >= 1) {
    b.has_scripts = 10;
  }

  // Rule: description_quality
  if (c.description.length >= 100) {
    // simple heuristic — description includes a trigger phrase like "use when" or "triggers on"
    const desc = c.description.toLowerCase();
    if (desc.includes("use when") || desc.includes("triggers on") || desc.includes("trigger")) {
      b.description_quality = 5;
    } else {
      b.description_quality = 3;  // partial credit for long descriptions
    }
  }

  // Rule: has_examples
  const body = primarySkill.body || "";
  if (/##\s+Examples?\s*$/im.test(body)) {
    b.has_examples = 10;
  }

  // Rule: passes_validation
  if (c.name && c.description && primarySkill.frontmatter?.name && primarySkill.frontmatter?.description) {
    b.passes_validation = 20;
  }

  // Rule: star_weight — log scale, max 25 points at 10k stars
  if (starCount > 0) {
    b.star_weight = Math.min(25, Math.floor(Math.log10(Math.max(starCount, 1)) * 10));
  }

  // Rule: has_tests
  const hasTests = (primarySkill.scripts || []).some((s: any) => {
    const path = typeof s === "string" ? s : s.path || "";
    return /^(test|validate|verify)/i.test(path.split("/").pop() || "");
  });
  if (hasTests) {
    b.has_tests = 20;
  }

  const total = Math.min(100, Object.values(b).reduce((a, v) => a + v, 0));
  const grade = total >= 85 ? "A" : total >= 70 ? "B" : total >= 50 ? "C" : total >= 30 ? "D" : "F";

  return { total, breakdown: b, grade };
}
```

## Test vectors (from `assets/fixtures/known-good/`)

```ts
// packages/mcp-server/tests/unit/scorer.test.ts
describe("scoreSkill", () => {
  it("openai/skills/.curated/pdf scores >= 70 (prompt line 147 invariant)", () => {
    const pdf = loadFixture("known-good/openai-pdf-skill.json");
    const score = scoreSkill(pdf, 16679); // openai/skills star count
    expect(score.total).toBeGreaterThanOrEqual(70);
  });

  it("BSI college-baseball-intelligence scores >= 80 (our own discipline)", () => {
    const cbi = loadFixture("known-good/bsi-college-baseball-intelligence.json");
    const score = scoreSkill(cbi, 0); // not on GitHub, no stars
    expect(score.total).toBeGreaterThanOrEqual(80);
  });

  it("minimal stub SKILL.md scores 0-30", () => {
    const stub = loadFixture("known-good/minimal-stub.json");
    const score = scoreSkill(stub, 0);
    expect(score.total).toBeLessThan(30);
  });

  it("score is deterministic", () => {
    const skill = loadFixture("known-good/openai-pdf-skill.json");
    const s1 = scoreSkill(skill, 1000);
    const s2 = scoreSkill(skill, 1000);
    expect(s1).toEqual(s2);
  });

  it("breakdown sums to total", () => {
    const skill = loadFixture("known-good/openai-pdf-skill.json");
    const score = scoreSkill(skill, 1000);
    const sum = Object.values(score.breakdown).reduce((a: number, v) => a + (v as number), 0);
    expect(score.total).toBe(Math.min(100, sum));
  });
});
```

## Known edge cases

- **Plugin with multiple skills.** Score the primary skill (skills[0]). Future enhancement: weighted average across skills + structural bonuses.
- **Skill with only body, no references/scripts.** Max ~35 points (description + examples + validation + stars).
- **Dormant repo.** Star weight applies anyway; may overweight a 5-year-old skill. Accept for v0.1; revisit with "last push age" penalty in v0.2.
- **Single-line description.** If ≥100 chars but on one line, still earns description_quality. If <100, earns 0.
- **Missing stars.** `starCount=0` → 0 points from star_weight. No penalty — just doesn't add.

## Filter presets

The `min_quality` parameter on `resolve-skill` defaults to 30. Common presets:

- `min_quality: 0` — show everything, including stubs
- `min_quality: 30` (default) — exclude obvious stubs
- `min_quality: 50` — "decent" quality bar
- `min_quality: 70` — "production-ready" bar
- `min_quality: 85` — curated, top-tier

## Scoring evolution

v0.1 is deliberately simple. Things we'd add later:
- Test-coverage ratio weight (if skill has tests/, how many branches covered)
- Install-count weight (measured from our own `install-skill` usage)
- Recency weight (last update age — older is slightly worse)
- Author reputation (from author's GitHub profile — scoring integrity carefully)
- Static analysis of SKILL.md body for anti-patterns

None of these in v0.1. Keep it simple, keep it deterministic, keep it testable.

## FTS+quality blend (in resolve-skill ranking)

```sql
ORDER BY
  (bm25(skills_fts) * 1.0) +                   -- FTS rank (lower = better)
  (1.0 - quality_score / 100.0) * 2.0          -- quality (higher = better), weighted 2x
ASC
LIMIT ?
```

Tune the 2.0 weight once we have real traffic data. v0.1 sets it conservatively.

## See also

- [`packages/mcp-server/src/lib/scorer.ts`](../../../packages/mcp-server/src/lib/scorer.ts) — implementation (authored Phase 2-P2-4)
- [`assets/fixtures/known-good/`](../assets/fixtures/known-good/) — test vectors with expected scores
- [`04-mcp-tool-design.md`](04-mcp-tool-design.md) — how `min_quality` filter works
- [`06-d1-schema-design.md`](06-d1-schema-design.md) — `quality_score` column semantics
