/**
 * The 9 verified upstream sources. Derived from docs/spikes/upstream-availability.md.
 * Tier A = active + permissive license, B = active + license-needs-inspection, C = dormant.
 */

export type Tier = "A" | "B" | "C";

export interface UpstreamSource {
  name: string; // owner/repo
  tier: Tier;
  poll_interval_seconds: number;
  paths: string[]; // relative to repo root
  manifest_hint: "claude-plugin" | "codex-plugin" | "standalone-skill" | "openai-agent";
}

export const SOURCES: UpstreamSource[] = [
  {
    name: "anthropics/claude-plugins-official",
    tier: "B",
    poll_interval_seconds: 21600,
    paths: ["plugins/", "external_plugins/"],
    manifest_hint: "claude-plugin",
  },
  {
    name: "anthropics/skills",
    tier: "B",
    poll_interval_seconds: 21600,
    paths: ["skills/"],
    manifest_hint: "standalone-skill",
  },
  {
    name: "anthropics/knowledge-work-plugins",
    tier: "A",
    poll_interval_seconds: 21600,
    paths: ["plugins/"],
    manifest_hint: "claude-plugin",
  },
  {
    name: "openai/codex",
    tier: "A",
    poll_interval_seconds: 21600,
    paths: ["plugins/"],
    manifest_hint: "codex-plugin",
  },
  {
    name: "openai/codex-plugin-cc",
    tier: "A",
    poll_interval_seconds: 21600,
    paths: ["."],
    manifest_hint: "codex-plugin",
  },
  {
    name: "openai/skills",
    tier: "B",
    poll_interval_seconds: 21600,
    paths: [".system/", ".curated/", ".experimental/"],
    manifest_hint: "standalone-skill",
  },
  {
    name: "openai/swarm",
    tier: "C",
    poll_interval_seconds: 86400,
    paths: ["examples/"],
    manifest_hint: "openai-agent",
  },
  {
    name: "openai/openai-agents-python",
    tier: "A",
    poll_interval_seconds: 21600,
    paths: ["examples/"],
    manifest_hint: "openai-agent",
  },
  {
    name: "openai/plugins",
    tier: "B",
    poll_interval_seconds: 21600,
    paths: ["."],
    manifest_hint: "codex-plugin",
  },
];
