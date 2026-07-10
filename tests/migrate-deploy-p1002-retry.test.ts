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

describe("migrate-deploy-safe — pre-warm before migrate deploy", () => {
  // The pre-warm function runs a trivial SELECT 1 via `prisma db execute --stdin`
  // BEFORE `prisma migrate deploy`. This wakes Neon's suspended compute so the
  // migrate-deploy step connects to an already-warm database and doesn't hit
  // P1001/P1002 cold-start timeouts. Without pre-warm, every cold-start build
  // logs a scary P1002 warning even though the existing retry logic eventually
  // succeeds — pre-warm eliminates the warning entirely on most builds.

  it("defines a prewarm() function", () => {
    const src = read("scripts/migrate-deploy-safe.mjs");
    assert.match(src, /function prewarm\(/);
  });

  it("prewarm runs prisma db execute with a SELECT 1 query", () => {
    const src = read("scripts/migrate-deploy-safe.mjs");
    // Must use `prisma db execute --stdin` (not a shell-escaped string) to
    // avoid injection and to leverage Prisma's own connection logic.
    assert.match(src, /prisma.*db.*execute.*--stdin/);
    assert.match(src, /SELECT 1/);
  });

  it("prewarm retries on P1001/P1002 with the same backoff as deploy()", () => {
    const src = read("scripts/migrate-deploy-safe.mjs");
    // The prewarm function must use the same DB_REACH_ERROR_CODES check and
    // the same exponential backoff — so a cold Neon compute has time to wake.
    assert.match(src, /Pre-warm: database unreachable \(P1001\/P1002\)/);
    assert.match(src, /prewarm\(attempt \+ 1\)/);
  });

  it("prewarm does NOT throw on failure — it lets deploy() retry", () => {
    const src = read("scripts/migrate-deploy-safe.mjs");
    // Prewarm is an optimization, not a gate. If it fails (e.g. database truly
    // down), it returns false and lets deploy() try with its own retry logic.
    assert.match(src, /Pre-warm did not succeed.*proceeding to migrate deploy/);
    // Extract just the prewarm function body and verify it has no `throw`
    // statement in its catch block — it must `return false` instead.
    // Strip comments first so "Don't throw" in a comment doesn't false-match.
    const prewarmStart = src.indexOf("function prewarm(");
    const prewarmEnd = src.indexOf("\n}\n", prewarmStart);
    const prewarmBody = src.slice(prewarmStart, prewarmEnd).replace(/\/\/[^\n]*/g, "");
    assert.ok(prewarmBody.length > 0, "prewarm function must exist");
    assert.ok(!/\bthrow\s+(error|new\s)/.test(prewarmBody), "prewarm must NOT throw — it must return false on failure");
    assert.match(prewarmBody, /return false/, "prewarm must return false on failure");
  });

  it("prewarm is called BEFORE the first deploy() attempt", () => {
    const src = read("scripts/migrate-deploy-safe.mjs");
    // The prewarm call must appear before the initial deploy() call so the
    // database is warm before migrate deploy runs.
    const prewarmCallIdx = src.indexOf("prewarm()");
    const deployCallIdx = src.indexOf("const initialResult = deploy()");
    assert.ok(prewarmCallIdx > -1, "prewarm() must be called");
    assert.ok(deployCallIdx > -1, "deploy() must be called");
    assert.ok(
      prewarmCallIdx < deployCallIdx,
      "prewarm() must be called BEFORE the initial deploy()",
    );
  });

  it("prewarm is skipped when preview migrations are skipped", () => {
    const src = read("scripts/migrate-deploy-safe.mjs");
    // The preview-skip early-exit (process.exit(0)) must happen BEFORE the
    // prewarm call — we don't want to connect to the database at all when
    // migrations are intentionally skipped on preview builds.
    const previewSkipIdx = src.indexOf('console.warn("Skipping database migrations by preview safety policy.');
    const prewarmCallIdx = src.indexOf("Pre-warming database connection");
    assert.ok(previewSkipIdx > -1, "preview-skip must exist");
    assert.ok(prewarmCallIdx > -1, "prewarm call must exist");
    assert.ok(
      previewSkipIdx < prewarmCallIdx,
      "preview-skip must run BEFORE prewarm (no DB connection when migrations are skipped)",
    );
  });
});
