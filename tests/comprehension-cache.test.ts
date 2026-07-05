// Unit tests for the in-memory comprehension cache (round 7).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  ComprehensionCache,
  getComprehensionCache,
  __resetComprehensionCacheForTests,
} from "../lib/engine/comprehension-cache";

describe("ComprehensionCache.keyFor — content hashing", () => {
  it("returns the same key for identical input", () => {
    const a = ComprehensionCache.keyFor("Tender X with content");
    const b = ComprehensionCache.keyFor("Tender X with content");
    assert.equal(a, b);
  });

  it("returns the same key for whitespace-normalised input", () => {
    const a = ComprehensionCache.keyFor("Tender X  with    content");
    const b = ComprehensionCache.keyFor("\nTender X with content\t");
    assert.equal(a, b);
  });

  it("returns different keys for different content", () => {
    const a = ComprehensionCache.keyFor("Tender X");
    const b = ComprehensionCache.keyFor("Tender Y");
    assert.notEqual(a, b);
  });

  it("produces a SHA-256-shaped hex digest (64 chars)", () => {
    const key = ComprehensionCache.keyFor("any input");
    assert.equal(key.length, 64);
    assert.match(key, /^[0-9a-f]{64}$/);
  });
});

describe("ComprehensionCache — get / set / LRU", () => {
  it("set then get returns the value", () => {
    const cache = new ComprehensionCache<string>();
    cache.set("x", "value-x");
    assert.equal(cache.get("x"), "value-x");
  });

  it("get on miss returns undefined", () => {
    const cache = new ComprehensionCache<string>();
    assert.equal(cache.get("missing"), undefined);
  });

  it("get on hit increments hit counter; miss increments miss counter", () => {
    const cache = new ComprehensionCache<string>();
    cache.set("x", "v");
    cache.get("x");
    cache.get("x");
    cache.get("missing");
    const stats = cache.getStats();
    assert.equal(stats.hits, 2);
    assert.equal(stats.misses, 1);
    assert.equal(stats.hitRate, 0.667);
  });

  it("overwriting an existing key replaces the value without growing the size", () => {
    const cache = new ComprehensionCache<string>();
    cache.set("x", "v1");
    cache.set("x", "v2");
    assert.equal(cache.get("x"), "v2");
    assert.equal(cache.getStats().size, 1);
  });

  it("respects MAX_ENTRIES — oldest entries are evicted", () => {
    const cache = new ComprehensionCache<string>();
    // MAX_ENTRIES is 64 in the implementation. Insert 70 distinct entries.
    for (let i = 0; i < 70; i++) {
      cache.set(`tender-${i}`, `value-${i}`);
    }
    const stats = cache.getStats();
    assert.equal(stats.size, 64);
    assert.equal(stats.evictions, 6);
    // First-inserted entries should be evicted.
    assert.equal(cache.get("tender-0"), undefined);
    // Most-recent entries should still be present.
    assert.equal(cache.get("tender-69"), "value-69");
  });

  it("LRU touch — get on an entry moves it to the end of the eviction order", () => {
    const cache = new ComprehensionCache<string>();
    for (let i = 0; i < 64; i++) {
      cache.set(`k${i}`, `v${i}`);
    }
    // Touch k0 — it should now be most-recent.
    cache.get("k0");
    // Add a new entry — k1 (the next-oldest) should be evicted, not k0.
    cache.set("new", "n");
    assert.equal(cache.get("k0"), "v0", "k0 should survive eviction after a touch");
    assert.equal(cache.get("k1"), undefined, "k1 should have been evicted");
  });
});

describe("ComprehensionCache — clear() and getStats()", () => {
  it("clear() resets size + counters", () => {
    const cache = new ComprehensionCache<string>();
    cache.set("a", "v");
    cache.get("a");
    cache.get("missing");
    cache.clear();
    const stats = cache.getStats();
    assert.equal(stats.size, 0);
    assert.equal(stats.hits, 0);
    assert.equal(stats.misses, 0);
    assert.equal(stats.evictions, 0);
  });

  it("hitRate is 0 when there have been no calls", () => {
    const cache = new ComprehensionCache<string>();
    assert.equal(cache.getStats().hitRate, 0);
  });
});

describe("getComprehensionCache singleton", () => {
  it("returns the same instance on repeated calls", () => {
    __resetComprehensionCacheForTests();
    const a = getComprehensionCache<string>();
    const b = getComprehensionCache<string>();
    assert.strictEqual(a, b);
  });

  it("reset replaces the singleton with a fresh instance", () => {
    const a = getComprehensionCache<string>();
    a.set("x", "v");
    __resetComprehensionCacheForTests();
    const b = getComprehensionCache<string>();
    assert.notStrictEqual(a, b);
    assert.equal(b.get("x"), undefined);
  });
});
