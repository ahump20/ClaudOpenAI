/**
 * Deterministic cache key derivation (mirrors packages/mcp-server/src/lib/cache.ts).
 * Worker-local copy; Workers can't import from npm workspaces without bundling.
 */

export function cacheKey(namespace: string, payload: Record<string, unknown>): string {
  const canonical = canonicalJson(payload);
  return `${namespace}:${djb2Hex(canonical)}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(",") +
    "}"
  );
}

function djb2Hex(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
