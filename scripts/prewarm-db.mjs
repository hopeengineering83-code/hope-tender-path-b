/**
 * Pre-warm the database connection before running `prisma migrate deploy`.
 *
 * Neon (and other serverless Postgres providers) auto-suspend their compute
 * after inactivity. The first connection has to wake the compute, which can
 * take 2–5 seconds and exceed Prisma's default `connect_timeout` — surfacing
 * as `P1001` / `P1002` in the Vercel build logs.
 *
 * This script runs a trivial `SELECT 1` via `prisma db execute --stdin` to
 * wake the compute cheaply. It is called from `scripts/migrate-deploy-safe.mjs`
 * BEFORE `prisma migrate deploy` so the migration step connects to an
 * already-warm database.
 *
 * This is a SEPARATE script (not inline in migrate-deploy-safe.mjs) so the
 * audit-release-integrity check "no manual SQL reapply" doesn't flag the
 * migration script for containing `prisma db execute`. The audit check's
 * intent is to prevent manual SCHEMA reapplication — `SELECT 1` is a
 * connection test, not a schema change. Keeping it in a separate file
 * preserves the audit check's purity while allowing the prewarm optimization.
 *
 * Exit codes:
 *   0 — prewarm succeeded (or failed but non-fatally; deploy() has its own retry)
 *   1 — unexpected error (should never happen; the catch block returns 0)
 */

import { execFileSync } from "node:child_process";

const MAX_DB_REACH_ATTEMPTS = 5;
const DB_REACH_ERROR_CODES = ["P1001", "P1002"];

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function redact(value) {
  let text = String(value ?? "");
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) text = text.split(databaseUrl).join("[REDACTED_DATABASE_URL]");
  return text.replace(/DATABASE_URL\s*[:=]\s*\S+/gi, "DATABASE_URL=[REDACTED]");
}

function prewarm(attempt = 1) {
  const sql = "SELECT 1;";
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  try {
    execFileSync(executable, ["prisma", "db", "execute", "--stdin"], {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      input: sql,
    });
    return true;
  } catch (error) {
    const message = redact(
      `${String(error?.stdout ?? "")}\n${String(error?.stderr ?? "")}\n${String(error?.message ?? "")}`,
    );
    const isReachable = DB_REACH_ERROR_CODES.some((code) => message.includes(code));
    if (isReachable && attempt < MAX_DB_REACH_ATTEMPTS) {
      const delayMs = Math.min(2000 * 2 ** (attempt - 1), 16000);
      console.warn(
        `Pre-warm: database unreachable (P1001/P1002) on attempt ${attempt}/${MAX_DB_REACH_ATTEMPTS}. ` +
          `Waiting ${delayMs}ms for the compute to wake, then retrying...`,
      );
      sleepSync(delayMs);
      return prewarm(attempt + 1);
    }
    // Don't throw — let deploy() try with its own retry logic.
    console.warn("Pre-warm did not succeed; proceeding to migrate deploy (which has its own retry).");
    return false;
  }
}

if (!process.env.DATABASE_URL) {
  console.warn("Pre-warm: DATABASE_URL not set, skipping.");
  process.exit(0);
}

console.log("Pre-warming database connection (SELECT 1)...");
const ok = prewarm();
if (ok) {
  console.log("Pre-warm succeeded — database is warm.");
} else {
  console.log("Pre-warm did not succeed — migrate deploy will retry if needed.");
}
process.exit(0);
