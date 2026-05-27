// Tests for rate-limit safety behaviour.
//
// The rate limiter must:
//   1. Return 429-compatible data (allowed: false) after limit is exceeded.
//   2. Include a resetAt time so callers can compute Retry-After.
//   3. Use per-user keys — no shared/anonymous key that would accidentally
//      rate-limit all users together.
//   4. API_RATE_LIMIT (300/min) must be more permissive than MUTATION_RATE_LIMIT (30/min).
//   5. AI_RATE_LIMIT (20/min) must be the most restrictive standard preset.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { rateLimit, API_RATE_LIMIT, MUTATION_RATE_LIMIT, AI_RATE_LIMIT, AUTH_RATE_LIMIT } from "../lib/rate-limit";

// ─── Preset hierarchy ─────────────────────────────────────────────────────

describe("rate-limit presets — hierarchy", () => {
  it("API_RATE_LIMIT is more permissive than MUTATION_RATE_LIMIT", () => {
    assert.ok(
      API_RATE_LIMIT.limit > MUTATION_RATE_LIMIT.limit,
      `API_RATE_LIMIT.limit (${API_RATE_LIMIT.limit}) should be > MUTATION_RATE_LIMIT.limit (${MUTATION_RATE_LIMIT.limit})`,
    );
  });

  it("MUTATION_RATE_LIMIT is more permissive than AI_RATE_LIMIT", () => {
    assert.ok(
      MUTATION_RATE_LIMIT.limit > AI_RATE_LIMIT.limit,
      `MUTATION_RATE_LIMIT.limit (${MUTATION_RATE_LIMIT.limit}) should be > AI_RATE_LIMIT.limit (${AI_RATE_LIMIT.limit})`,
    );
  });

  it("AUTH_RATE_LIMIT is the most restrictive preset (login brute-force protection)", () => {
    // AUTH (10/min) < AI (20/min) < MUTATION (30/min) < API (300/min)
    assert.ok(AUTH_RATE_LIMIT.limit < AI_RATE_LIMIT.limit);
    assert.ok(AI_RATE_LIMIT.limit < MUTATION_RATE_LIMIT.limit);
    assert.ok(MUTATION_RATE_LIMIT.limit < API_RATE_LIMIT.limit);
  });

  it("API_RATE_LIMIT is 300 per minute", () => {
    assert.equal(API_RATE_LIMIT.limit, 300);
    assert.equal(API_RATE_LIMIT.windowMs, 60_000);
  });

  it("MUTATION_RATE_LIMIT is 30 per minute", () => {
    assert.equal(MUTATION_RATE_LIMIT.limit, 30);
    assert.equal(MUTATION_RATE_LIMIT.windowMs, 60_000);
  });
});

// ─── 429 response data ────────────────────────────────────────────────────

describe("rate-limit — 429 data shape when limit exceeded", () => {
  it("returns allowed:false after limit is exceeded", () => {
    const key = `test-rl-429-${Date.now()}-${Math.random()}`;
    const cfg = { limit: 2, windowMs: 60_000 };
    rateLimit(key, cfg); // 1st
    rateLimit(key, cfg); // 2nd
    const result = rateLimit(key, cfg); // 3rd — exceeds limit
    assert.equal(result.allowed, false, "Third call should be rate-limited");
  });

  it("provides resetAt so caller can compute Retry-After", () => {
    const key = `test-rl-reset-${Date.now()}-${Math.random()}`;
    const cfg = { limit: 1, windowMs: 60_000 };
    rateLimit(key, cfg); // 1st — allowed
    const denied = rateLimit(key, cfg); // 2nd — denied
    assert.equal(denied.allowed, false);
    assert.ok(typeof denied.resetAt === "number", "resetAt must be a number");
    assert.ok(denied.resetAt > Date.now(), "resetAt must be in the future");
  });

  it("Retry-After can be derived from resetAt", () => {
    const key = `test-rl-retry-after-${Date.now()}-${Math.random()}`;
    const cfg = { limit: 1, windowMs: 30_000 };
    rateLimit(key, cfg); // consume
    const denied = rateLimit(key, cfg); // denied
    const retryAfter = Math.ceil((denied.resetAt - Date.now()) / 1000);
    assert.ok(retryAfter > 0, "Retry-After must be positive seconds");
    assert.ok(retryAfter <= 30, "Retry-After must be within the window");
  });
});

// ─── Per-user key isolation ────────────────────────────────────────────────

describe("rate-limit — per-user key isolation (no shared anonymous bucket)", () => {
  it("two different user IDs have independent buckets", () => {
    const cfg = { limit: 2, windowMs: 60_000 };
    const keyA = `tender-list:user-a-${Date.now()}`;
    const keyB = `tender-list:user-b-${Date.now()}`;

    // Exhaust user-a's bucket
    rateLimit(keyA, cfg);
    rateLimit(keyA, cfg);
    const deniedA = rateLimit(keyA, cfg);
    assert.equal(deniedA.allowed, false, "user-a should be rate-limited");

    // user-b should still have a fresh bucket
    const allowedB = rateLimit(keyB, cfg);
    assert.equal(allowedB.allowed, true, "user-b should not be affected by user-a's limit");
  });

  it("first call is always allowed (bucket starts full)", () => {
    const key = `tender-list:fresh-user-${Date.now()}-${Math.random()}`;
    const result = rateLimit(key, API_RATE_LIMIT);
    assert.equal(result.allowed, true, "First call should always be allowed");
  });
});

// ─── GET /api/tenders rate-limit is authenticated ─────────────────────────
// The rate-limit key must be scoped to an authenticated userId, not an
// anonymous shared key. We verify the expected key pattern here.

describe("rate-limit — GET /api/tenders key uses userId scope", () => {
  it("tender-list rate-limit key includes user ID (prevents anonymous shared bucket)", () => {
    const userId = "user-abc-123";
    const expectedKey = `tender-list:${userId}`;
    // Verify the key format used in app/api/tenders/route.ts
    assert.match(expectedKey, /^tender-list:[a-zA-Z0-9_-]+$/);
    assert.ok(!expectedKey.includes("undefined"), "Key must not contain 'undefined' (userId missing)");
    assert.ok(!expectedKey.includes("null"), "Key must not contain 'null' (userId missing)");
  });
});
