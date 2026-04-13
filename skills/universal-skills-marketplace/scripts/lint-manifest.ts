#!/usr/bin/env node
/**
 * lint-manifest.ts — validate any plugin.json against both Claude and Codex zod schemas.
 * Usage: node lint-manifest.ts <path-to-plugin.json>
 *
 * Exit 0 = valid against at least one ecosystem schema.
 * Exit 1 = valid against neither.
 *
 * NOTE: This is a Phase-1 scaffold script. Full implementation wires to
 * @blazesportsintel/universal-skills-schema once Phase 2 ships that package.
 * For now, validates minimal required fields + reports which ecosystem it looks like.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
if (args.length !== 1 || args[0] === "--help") {
  console.error("Usage: node lint-manifest.ts <path-to-plugin.json>");
  process.exit(1);
}

const filePath = resolve(args[0]);
if (!existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

let manifest: Record<string, unknown>;
try {
  manifest = JSON.parse(readFileSync(filePath, "utf8"));
} catch (err) {
  console.error(`Invalid JSON in ${filePath}: ${(err as Error).message}`);
  process.exit(1);
}

const CLAUDE_REQUIRED = ["name", "description"];
const CODEX_REQUIRED = [
  "name", "version", "description", "author", "homepage", "repository",
  "license", "keywords", "skills", "interface"
];
const CODEX_INTERFACE_REQUIRED = [
  "displayName", "shortDescription", "longDescription", "category",
  "capabilities", "websiteURL", "privacyPolicyURL", "termsOfServiceURL",
  "defaultPrompt", "composerIcon", "logo", "screenshots"
];

function checkRequired(obj: Record<string, unknown>, required: string[]): string[] {
  return required.filter(key => !(key in obj));
}

const claudeMissing = checkRequired(manifest, CLAUDE_REQUIRED);
const codexMissing = checkRequired(manifest, CODEX_REQUIRED);
let interfaceMissing: string[] = [];
if (manifest.interface && typeof manifest.interface === "object") {
  interfaceMissing = checkRequired(manifest.interface as Record<string, unknown>, CODEX_INTERFACE_REQUIRED);
}

const isClaudeValid = claudeMissing.length === 0;
const isCodexValid = codexMissing.length === 0 && interfaceMissing.length === 0;

console.log(`=== ${filePath} ===`);
console.log(`Claude ecosystem: ${isClaudeValid ? "✓ valid" : `✗ missing: ${claudeMissing.join(", ")}`}`);
console.log(`Codex ecosystem:  ${isCodexValid ? "✓ valid" : `✗ missing top-level: [${codexMissing.join(", ")}]${interfaceMissing.length > 0 ? `; missing interface.*: [${interfaceMissing.join(", ")}]` : ""}`}`);

if (isClaudeValid && !isCodexValid) {
  console.log("Verdict: Claude-style plugin (convention-based)");
} else if (!isClaudeValid && isCodexValid) {
  console.log("Verdict: Codex-style plugin (declarative)");
} else if (isClaudeValid && isCodexValid) {
  console.log("Verdict: valid in both (has Codex shape)");
}

if (!isClaudeValid && !isCodexValid) {
  console.log("Verdict: INVALID in both ecosystems");
  process.exit(1);
}

process.exit(0);
