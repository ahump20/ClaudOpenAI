#!/usr/bin/env node
/**
 * test-translator.ts — translator round-trip runner.
 * Usage: node test-translator.ts --all-fixtures
 *        node test-translator.ts --fixture <path>
 *
 * Verifies:
 *  1. Round-trip identity (claude->canonical->claude == claude, modulo translation_log)
 *  2. Lossy cases recover via ecosystem_extensions sidecar
 *  3. Malformed inputs throw typed errors
 *
 * NOTE: This is a Phase-1 scaffold that prints the test PLAN.
 * Full implementation wires to packages/mcp-server/src/lib/translator.ts once Phase 2 ships.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_DIR = resolve(__dirname, "../assets/fixtures");

const args = process.argv.slice(2);
const allFixtures = args.includes("--all-fixtures");
const specificFixtureIdx = args.indexOf("--fixture");
const specificFixture = specificFixtureIdx >= 0 ? args[specificFixtureIdx + 1] : null;

if (!allFixtures && !specificFixture) {
  console.error("Usage: node test-translator.ts --all-fixtures | --fixture <path>");
  process.exit(1);
}

console.log("=== Translator round-trip test runner ===\n");
console.log("NOTE: Phase-1 scaffold — this script enumerates the test plan.");
console.log("Full round-trip execution is deferred to Phase 2 when translator.ts ships in packages/mcp-server/.\n");

const categories = ["known-good", "lossy-cases", "malformed"];
let totalFixtures = 0;
let planned = 0;

for (const cat of categories) {
  const catDir = resolve(FIXTURES_DIR, cat);
  if (!existsSync(catDir)) continue;
  const files = readdirSync(catDir).filter(f => f.endsWith(".json") || f.endsWith(".md"));
  if (files.length === 0) continue;

  console.log(`--- ${cat} ---`);
  for (const file of files) {
    if (file === "README.md") continue;
    totalFixtures++;
    const path = resolve(catDir, file);
    const plan = testPlanFor(cat, file, path);
    console.log(`  ${plan.ok ? "📋" : "✗"} ${file}`);
    for (const check of plan.checks) {
      console.log(`      - ${check}`);
    }
    planned++;
  }
  console.log();
}

console.log(`=== Summary: ${planned} fixtures enumerated in test plan ===`);
console.log("");
console.log("To execute the full round-trip test suite (Phase 2):");
console.log("  npm run test:unit -w @blazesportsintel/universal-skills-mcp");

function testPlanFor(category: string, filename: string, path: string): { ok: boolean; checks: string[] } {
  const checks: string[] = [];
  if (category === "known-good") {
    checks.push("toCanonical(input) produces valid CanonicalSkill (zod parse succeeds)");
    checks.push("fromCanonical(canonical, origin.ecosystem) produces byte-identical-ish output");
    checks.push("diff shows no unexpected fields");
    if (filename.includes("pdf")) {
      checks.push("scoreSkill() returns >= 70 (prompt line 147 invariant)");
    }
    if (filename.includes("stub")) {
      checks.push("scoreSkill() returns < 30");
    }
  } else if (category === "lossy-cases") {
    checks.push("translation_log contains expected { level: 'lossy', field: ... } entries");
    checks.push("ecosystem_extensions sidecar written with preserved fields");
    checks.push("round-trip via opposite ecosystem restores all semantic fields");
    checks.push("round-trip diff ≤ expected JSON-patch ops");
  } else if (category === "malformed") {
    checks.push("parse throws typed error (InvalidFrontmatterError / YAMLParseError / etc.)");
    checks.push("error message includes file line number if YAML");
  }
  return { ok: true, checks };
}
