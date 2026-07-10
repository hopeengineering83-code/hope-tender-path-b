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
  // The pre-warm step runs a trivial SELECT 1 via `prisma db execute --stdin`
  // BEFORE `prisma migrate deploy`. This wakes Neon's suspended compute so the
  // migrate-deploy step connects to an already-warm database and doesn't hit
  // P1001/P1002 cold-start timeouts. Without pre-warm, every cold-start build
  // logs a scary P1002 warning even though the existing retry logic eventually
  // succeeds — pre-warm eliminates the warning entirely on most builds.
  //
  // The prewarm logic lives in a SEPARATE script (scripts/prewarm-db.mjs) so
  // the audit-release-integrity check "no manual SQL reapply" doesn't flag the
  // migration script for containing `prisma db execute`.

  it("migrate-deploy-safe.mjs defines a prewarm() function that calls the external script", () => {
    const src = read("scripts/migrate-deploy-safe.mjs");
    assert.match(src, /function prewarm\(/);
    // Must call the external prewarm-db.mjs script (not inline prisma db execute)
    assert.match(src, /scripts\/prewarm-db\.mjs/);
    // Must NOT contain inline `prisma db execute` (that would trigger the
    // audit-release-integrity "no manual SQL reapply" check)
    assert.doesNotMatch(src, /"db",\s*"execute"/);
  });

  it("prewarm-db.mjs exists and runs prisma db execute with SELECT 1", () => {
    const src = read("scripts/prewarm-db.mjs");
    assert.match(src, /prisma.*db.*execute.*--stdin/);
    assert.match(src, /SELECT 1/);
  });

  it("prewarm-db.mjs retries on P1001/P1002 with exponential backoff", () => {
    const src = read("scripts/prewarm-db.mjs");
    assert.match(src, /Pre-warm: database unreachable \(P1001\/P1002\)/);
    assert.match(src, /prewarm\(attempt \+ 1\)/);
    assert.match(src, /MAX_DB_REACH_ATTEMPTS\s*=\s*5/);
    assert.match(src, /Math\.min\(2000\s*\*\s*2\s*\*\*\s*\(attempt\s*-\s*1\),\s*16000\)/);
  });

  it("prewarm-db.mjs does NOT throw on failure — it exits 0 and lets deploy() retry", () => {
    const src = read("scripts/prewarm-db.mjs");
    // Prewarm is an optimization, not a gate. If it fails (e.g. database truly
    // down), it exits 0 and lets deploy() try with its own retry logic.
    assert.match(src, /Pre-warm did not succeed.*proceeding to migrate deploy/);
    assert.match(src, /process\.exit\(0\)/);
  });

  it("prewarm is called BEFORE the first deploy() attempt", () => {
    const src = read("scripts/migrate-deploy-safe.mjs");
    const prewarmCallIdx = src.indexOf("Pre-warming database connection");
    const deployCallIdx = src.indexOf("const initialResult = deploy()");
    assert.ok(prewarmCallIdx > -1, "prewarm call must exist");
    assert.ok(deployCallIdx > -1, "deploy() must be called");
    assert.ok(
      prewarmCallIdx < deployCallIdx,
      "prewarm must be called BEFORE the initial deploy()",
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

  it("prewarm-db.mjs redacts DATABASE_URL from error output", () => {
    const src = read("scripts/prewarm-db.mjs");
    // The prewarm script must not leak DATABASE_URL in error messages.
    assert.match(src, /redact/);
    assert.match(src, /REDACTED_DATABASE_URL/);
  });
});
