/**
 * In-memory LRU cache for deep tender comprehension.
 *
 * Comprehension extraction is the single most expensive
 * deep-reasoning AI call (one Claude call per tender, ~4–6 seconds).
 * The result is DETERMINISTIC per tender text — same input, same
 * output — so re-running generation on a tender that hasn't changed
 * burns budget needlessly.
 *
 * This module memoises comprehension by a content hash of the
 * tender text. Cache hits skip the AI call entirely, returning the
 * cached value. Cache misses run the extractor and store the result.
 *
 * Design choices:
 *
 *   - SCOPE: in-memory only, per Node process. No Redis, no DB. The
 *     hit rate within a single warm process (e.g. operator clicking
 *     regenerate twice in a row, or running parallel API calls)
 *     captures the highest-value scenarios; cross-process caching
 *     would need persistence and is out of scope.
 *
 *   - KEY: SHA-256 of the normalised tender text (whitespace
 *     collapsed). Same content → same key regardless of formatting.
 *
 *   - LRU: bounded to MAX_ENTRIES. When full, the oldest entry is
 *     evicted. Prevents memory growth on long-lived processes.
 *
 *   - TTL: entries expire after TTL_MS. Defends against stale data
 *     when a tender's text changes outside this cache's view (e.g.
 *     a re-upload that produces near-identical text — different
 *     hash means the new generation re-extracts anyway, but the
 *     old entry is still in the cache until evicted).
 *
 *   - OBSERVABILITY: hit/miss counters exposed via `getStats()`
 *     for the diagnostic endpoint.
 */

import { createHash } from "node:crypto";

const MAX_ENTRIES = 64;            // Bounded — typical tenant runs fit comfortably
const TTL_MS = 30 * 60 * 1000;     // 30 minutes — matches typical operator session

type CacheEntry<T> = {
  key: string;
  value: T;
  storedAt: number;
};

export class ComprehensionCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  /**
   * Hash the input so semantically-identical text (different
   * whitespace, trailing newlines) maps to the same key.
   *
   * SHA-256 is used because it's cryptographically strong and
   * collision-resistant — overkill for a cache key but cheap on
   * Node's openssl backend.
   */
  static keyFor(text: string): string {
    const normalised = text.replace(/\s+/g, " ").trim();
    return createHash("sha256").update(normalised).digest("hex");
  }

  /**
   * Retrieve a cached value. Returns `undefined` on miss or expiry.
   * Hits update the entry's position in the LRU order.
   */
  get(text: string): T | undefined {
    const key = ComprehensionCache.keyFor(text);
    const entry = this.store.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    if (Date.now() - entry.storedAt > TTL_MS) {
      this.store.delete(key);
      this.misses += 1;
      return undefined;
    }
    // LRU touch: re-insert to move to the end.
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits += 1;
    return entry.value;
  }

  /**
   * Insert a value. Evicts the oldest entry when at capacity.
   */
  set(text: string, value: T): void {
    const key = ComprehensionCache.keyFor(text);
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= MAX_ENTRIES) {
      // Evict the first-inserted entry (Map preserves insertion order).
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) {
        this.store.delete(firstKey);
        this.evictions += 1;
      }
    }
    this.store.set(key, { key, value, storedAt: Date.now() });
  }

  /**
   * Diagnostic stats — surfaced via the deep-reasoning status
   * endpoint so operators can monitor cache effectiveness.
   */
  getStats(): {
    size: number;
    capacity: number;
    hits: number;
    misses: number;
    evictions: number;
    hitRate: number;
  } {
    const total = this.hits + this.misses;
    return {
      size: this.store.size,
      capacity: MAX_ENTRIES,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRate: total > 0 ? Math.round((this.hits / total) * 1000) / 1000 : 0,
    };
  }

  /**
   * Reset cache state. Used by tests; product code should never
   * need to clear the cache manually.
   */
  clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }
}

// Singleton instance shared across the engine. Module-level state
// is fine here because the cache is purely in-memory and per-process;
// each Vercel function invocation gets its own instance.
let singleton: ComprehensionCache<unknown> | null = null;

export function getComprehensionCache<T>(): ComprehensionCache<T> {
  if (!singleton) {
    singleton = new ComprehensionCache<T>();
  }
  return singleton as ComprehensionCache<T>;
}

/**
 * Test-only: replace the singleton with a fresh cache. Never call
 * from product code.
 */
export function __resetComprehensionCacheForTests(): void {
  singleton = null;
}
