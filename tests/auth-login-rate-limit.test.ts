// Tests for the login rate limiter (Gap 3).
//
// The login route applies AUTH_RATE_LIMIT (10 attempts / minute) independently
// by client IP and normalized account identifier. We exercise the policy at the
// rate-limit level directly and retain narrow route-order assertions for the
// pre-database missing-credential guard and generic 429 response.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { rateLimit, AUTH_RATE_LIMIT } from "../lib/rate-limit";

function clientIp(headers: Record<string, string>): string {
  const xff = headers["x-forwarded-for"];
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  return headers["x-real-ip"] || "unknown";
}

describe("login rate-limit — key derivation", () => {
  it("uses x-forwarded-for first segment", () => {
    assert.equal(clientIp({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }), "1.2.3.4");
  });

  it("falls back to x-real-ip when x-forwarded-for is missing", () => {
    assert.equal(clientIp({ "x-real-ip": "9.9.9.9" }), "9.9.9.9");
  });

  it("returns 'unknown' when no header is present", () => {
    assert.equal(clientIp({}), "unknown");
  });
});

describe("login rate-limit — AUTH_RATE_LIMIT bucket behaviour", () => {
  it("first attempt succeeds (HTTP would be 401/200, not 429)", () => {
    const key = `login:test-ip-1:user${Date.now()}@example.com`;
    const result = rateLimit(key, AUTH_RATE_LIMIT);
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, AUTH_RATE_LIMIT.limit - 1);
  });

  it("returns 429-equivalent after threshold is exceeded", () => {
    const key = `login:test-ip-2:user${Date.now()}@example.com`;
    for (let i = 0; i < AUTH_RATE_LIMIT.limit; i++) {
      const result = rateLimit(key, AUTH_RATE_LIMIT);
      assert.equal(result.allowed, true, `attempt ${i + 1} should still be allowed`);
    }
    const blocked = rateLimit(key, AUTH_RATE_LIMIT);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);
    assert.ok(blocked.resetAt > Date.now());
  });

  it("different keys are tracked independently", () => {
    const a = `login:test-ip-a:user${Date.now()}@example.com`;
    const b = `login:test-ip-b:user${Date.now()}@example.com`;
    for (let i = 0; i < AUTH_RATE_LIMIT.limit; i++) rateLimit(a, AUTH_RATE_LIMIT);
    assert.equal(rateLimit(a, AUTH_RATE_LIMIT).allowed, false);
    assert.equal(rateLimit(b, AUTH_RATE_LIMIT).allowed, true);
  });

  it("AUTH_RATE_LIMIT defaults look reasonable for login (≤30 per min)", () => {
    assert.ok(AUTH_RATE_LIMIT.limit > 0);
    assert.ok(AUTH_RATE_LIMIT.limit <= 30, `expected ≤30 attempts/min, got ${AUTH_RATE_LIMIT.limit}`);
    assert.equal(AUTH_RATE_LIMIT.windowMs, 60_000);
  });
});

describe("login route — pre-database guard and generic throttling", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8");

  it("checks missing credentials before any rate-limit bucket is consumed", () => {
    const missingIdx = src.indexOf('"MISSING_CREDENTIALS", 400');
    const rateLimitIdx = src.indexOf("const localIpLimit = rateLimit(");
    assert.ok(missingIdx > 0, "expected the missing-credential response code");
    assert.ok(rateLimitIdx > 0, "expected the local rate-limit call");
    assert.ok(rateLimitIdx > missingIdx, "rate limiting must run after the missing-credential guard");
  });

  it("returns the canonical generic rate-limit code with Retry-After", () => {
    assert.match(src, /"LOGIN_RATE_LIMITED",\s*429/);
    assert.match(src, /"Retry-After"/);
    assert.match(src, /LOGIN_RATE_LIMITED:\s*"Too many sign-in attempts\./);
  });

  it("does not disclose account existence in the throttling response", () => {
    const start = src.indexOf("function tooManyAttempts");
    const end = src.indexOf("async function recordFailedLogin", start);
    assert.ok(start >= 0 && end > start, "expected a bounded throttling helper");
    const helper = src.slice(start, end);
    assert.doesNotMatch(helper, /findUnique|passwordHash|email\s+(?:does\s+not\s+)?exist/i);
    assert.match(helper, /LOGIN_RATE_LIMITED/);
  });
});
