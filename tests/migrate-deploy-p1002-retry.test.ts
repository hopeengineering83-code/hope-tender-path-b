// Regression test: migrate-deploy-safe.mjs MUST retry P1002 (database was
// temporarily unreachable), not just P1001. Both codes cover the same
// cold-start failure mode on serverless Postgres (Neon, Supabase, Railway)
// and a single failure must NOT kill the Vercel build.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("migrate-deploy-safe — database reachability retry", () => {
  it("declares both P1001 and P1002 as retryable reachability errors", () => {
    const src = read("scripts/migrate-deploy-safe.mjs");
    // Both codes must be listed in the retryable set.
    assert.match(src, /DB_REACH_ERROR_CODES\s*=\s*\[\s*"P1001"\s*,\s*"P1002"\s*\]/);
  });

  it("the retry loop tests BOTH codes against the error message", () => {
    const src = read("scripts/migrate-deploy-safe.mjs");
    // The loop must use the shared array, not a hardcoded P1001-only check.
    assert.match(src, /DB_REACH_ERROR_CODES\.some\(\(code\) => message\.includes\(code\)\)/);
    // Must NOT still have a P1001-only hardcoded check that bypasses the array.
    assert.doesNotMatch(src, /message\.includes\("P1001"\)\s*&&\s*attempt/);
  });

  it("retries up to MAX_DB_REACH_ATTEMPTS times for both codes", () => {
    const src = read("scripts/migrate-deploy-safe.mjs");
    assert.match(src, /MAX_DB_REACH_ATTEMPTS\s*=\s*5/);
    // The retry guard must use the shared predicate, not P1001-only.
    assert.match(src, /isReachable\s*&&\s*attempt\s*<\s*MAX_DB_REACH_ATTEMPTS/);
  });

  it("uses exponential backoff capped at 16 seconds", () => {
    const src = read("scripts/migrate-deploy-safe.mjs");
    assert.match(src, /Math\.min\(2000\s*\*\s*2\s*\*\*\s*\(attempt\s*-\s*1\),\s*16000\)/);
  });

  it("the warning message names BOTH codes so operators can diagnose either", () => {
    const src = read("scripts/migrate-deploy-safe.mjs");
    // The log line must surface both codes so an operator seeing P1002 in
    // their Vercel build logs can connect it to this retry path.
    assert.match(src, /Database unreachable \(\$\{codes\}\)/);
  });
});
