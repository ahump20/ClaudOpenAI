/**
 * Cache interface + in-memory implementation for Phase 2.
 * Phase 3 Worker code implements the same interface with KV-backed storage.
 */
import { LRUCache } from "lru-cache";

export interface Cache<V> {
  get(key: string): Promise<V | undefined>;
  set(key: string, value: V, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export class LruMemoryCache<V extends NonNullable<unknown>> implements Cache<V> {
  private readonly lru: LRUCache<string, V>;

  constructor(options: { max?: number; defaultTtlMs?: number } = {}) {
    this.lru = new LRUCache<string, V>({
      max: options.max ?? 1000,
      ttl: options.defaultTtlMs ?? 10 * 60 * 1000,
      updateAgeOnGet: false,
      updateAgeOnHas: false,
    });
  }

  async get(key: string): Promise<V | undefined> {
    return this.lru.get(key);
  }

  async set(key: string, value: V, ttlMs?: number): Promise<void> {
    if (ttlMs) {
      this.lru.set(key, value, { ttl: ttlMs });
    } else {
      this.lru.set(key, value);
    }
  }

  async delete(key: string): Promise<void> {
    this.lru.delete(key);
  }
}

/**
 * Deterministic cache key derived from an object. Sorts keys recursively so
 * { query: "pdf", limit: 10 } and { limit: 10, query: "pdf" } produce the same hash.
 */
export function cacheKey(namespace: string, payload: Record<string, unknown>): string {
  const normalized = canonicalJson(payload);
  return `${namespace}:${djb2Hex(normalized)}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return "{" + keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(",") + "}";
}

function djb2Hex(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
