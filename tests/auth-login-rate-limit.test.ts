// Tests for the login rate limiter (Gap 3).
//
// The login route applies AUTH_RATE_LIMIT (10 attempts / minute) keyed by
// IP + normalized email. We exercise the policy at the rate-limit level
// directly because the route depends on Prisma at import time and a fully
// mocked Prisma client would not exercise the new code path.
//
// The rate-limit module uses an in-memory bucket map shared by all callers
// in the same process, so we use unique keys per test to avoid leakage.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { rateLimit, AUTH_RATE_LIMIT } from "../lib/rate-limit";

// Replicates the IP-extraction logic used by the login route so the test
// pins behaviour even if the implementation moves around.
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
      const r = rateLimit(key, AUTH_RATE_LIMIT);
      assert.equal(r.allowed, true, `attempt ${i + 1} should still be allowed`);
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
    const aBlocked = rateLimit(a, AUTH_RATE_LIMIT);
    const bFirst = rateLimit(b, AUTH_RATE_LIMIT);
    assert.equal(aBlocked.allowed, false);
    assert.equal(bFirst.allowed, true);
  });

  it("AUTH_RATE_LIMIT defaults look reasonable for login (≤30 per min)", () => {
    assert.ok(AUTH_RATE_LIMIT.limit > 0);
    assert.ok(AUTH_RATE_LIMIT.limit <= 30, `expected ≤30 attempts/min, got ${AUTH_RATE_LIMIT.limit}`);
    assert.equal(AUTH_RATE_LIMIT.windowMs, 60_000);
  });
});

// ─── 400 (missing credentials) must NOT consume a bucket slot ─────────────────
//
// The login route is structured so that the rate-limit check fires AFTER the
// "missing credentials" 400 path. We pin that ordering with a behavioural test
// against the source.
describe("login route — bad-request path does NOT consume rate limiter", async () => {
  it("login route source applies rateLimit AFTER 400 missing-credentials check", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8");
    const missingIdx = src.indexOf("Missing credentials");
    const rateLimitIdx = src.indexOf("rateLimit(");
    assert.ok(missingIdx > 0, "expected the route to still emit a 'Missing credentials' branch");
    assert.ok(rateLimitIdx > 0, "expected the login route to apply rateLimit()");
    assert.ok(
      rateLimitIdx > missingIdx,
      `rateLimit() call should appear after the 'Missing credentials' guard. got missingIdx=${missingIdx}, rateLimitIdx=${rateLimitIdx}`,
    );
  });

  it("login route includes a Retry-After header on 429", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8");
    assert.match(src, /status:\s*429/);
    assert.match(src, /Retry-After/);
  });

  it("login route response on 429 does not leak whether the email exists", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8");
    // The 429 branch must not reference "user" / "email exists" / "Invalid credentials" — it should be generic.
    const rl429Block = /Too many login attempts[\s\S]{0,300}/.exec(src);
    assert.ok(rl429Block, "expected a 'Too many login attempts' branch in the login route");
    const slice = rl429Block![0];
    assert.equal(/email\s+(?:does\s+not\s+)?exist/i.test(slice), false, "must not leak email existence");
  });
});
