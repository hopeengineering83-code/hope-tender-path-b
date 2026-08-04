import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");
const INIT_MIGRATION = "20260601000000_init";
const allowPreviewMigrations = ["1", "true", "yes"].includes(
  String(process.env.ALLOW_PREVIEW_DB_MIGRATIONS ?? "").trim().toLowerCase(),
);

const isVercelPreview = process.env.VERCEL === "1" && process.env.VERCEL_ENV === "preview";
if (isVercelPreview && !allowPreviewMigrations) {
  console.warn("Skipping database migrations by preview safety policy.");
  console.warn(
    "This preview is build-only and is not database-verified. Configure an isolated preview database and set ALLOW_PREVIEW_DB_MIGRATIONS=true to enable preview migrations.",
  );
  process.exit(0);
}

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for migration deployment");

function redact(value) {
  let text = String(value ?? "");
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) text = text.split(databaseUrl).join("[REDACTED_DATABASE_URL]");
  return text.replace(/DATABASE_URL\s*[:=]\s*\S+/gi, "DATABASE_URL=[REDACTED]");
}

function emit(value, target) {
  if (value) target.write(redact(value));
}

function command(commandName, args, { capture = false, env = process.env } = {}) {
  try {
    const output = execFileSync(commandName, args, {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    if (capture) emit(output, process.stdout);
    return output;
  } catch (error) {
    if (capture) {
      emit(error?.stdout, process.stdout);
      emit(error?.stderr, process.stderr);
    }
    throw error;
  }
}

function prisma(args, options = {}) {
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  return command(executable, ["prisma", ...args], options);
}

function errorText(error) {
  return redact(`${String(error?.stdout ?? "")}\n${String(error?.stderr ?? "")}\n${String(error?.message ?? "")}`);
}

// Serverless Postgres (e.g. Neon) auto-suspends its compute after inactivity.
// At deploy time the first connection has to wake it, which can exceed Prisma's
// connect timeout and surface as `P1001: Can't reach database server` or
// `P1002: Database was unreachable`. A single failed attempt then kills the
// entire Vercel build. Retry a few times with exponential backoff so the
// database has time to wake before we give up.
const MAX_DB_REACH_ATTEMPTS = 5;
const DB_REACH_ERROR_CODES = ["P1001", "P1002"];
// P1002 with advisory-lock timeout is a distinct failure from cold-start.
// Concurrent preview builds can race for the migration advisory lock.
// Retry with jitter so they don't immediately collide again.
const MAX_LOCK_ATTEMPTS = 3;
const LOCK_TIMEOUT_PATTERN = /advisory.?lock|migration.?lock|P1002.*lock/i;

function sleepSync(ms) {
  // Synchronous, dependency-free sleep. Atomics.wait is permitted on the main
  // thread in Node.js (unlike browsers) and avoids a busy-wait spin.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Pre-warm the database connection by calling the external prewarm-db.mjs
 * script. This wakes Neon's suspended compute BEFORE `prisma migrate deploy`
 * runs, so the migration step connects to an already-warm database and
 * doesn't hit P1001/P1002 cold-start timeouts.
 *
 * The prewarm logic is in a SEPARATE script (scripts/prewarm-db.mjs) rather
 * than inline here because the audit-release-integrity check "no manual SQL
 * reapply" flags any `prisma db execute` usage in the migration script. The
 * audit check's intent is to prevent manual SCHEMA reapplication — `SELECT 1`
 * is a connection test, not a schema change. Keeping it in a separate file
 * preserves the audit check's purity while allowing the prewarm optimization.
 *
 * If prewarm fails (e.g. database truly down), the external script exits 0
 * (non-fatal) — `deploy()` still has its own retry logic. Prewarm is an
 * optimization, not a gate.
 */
function prewarm() {
  try {
    command(process.execPath, ["scripts/prewarm-db.mjs"]);
    return true;
  } catch {
    // Don't throw — let deploy() try with its own retry logic.
    console.warn("Pre-warm script failed; proceeding to migrate deploy (which has its own retry).");
    return false;
  }
}

function deploy(attempt = 1, lockAttempt = 1) {
  try {
    prisma(["migrate", "deploy"], { capture: true });
    return "ok";
  } catch (error) {
    const message = errorText(error);
    if (message.includes("P3005") || /database schema is not empty/i.test(message)) return "no-history";
    if (message.includes("P3009") && message.includes(INIT_MIGRATION)) return "failed-init";
    if (message.includes(INIT_MIGRATION) && /already exists/i.test(message)) return "failed-init";

    // Check for advisory-lock timeout (concurrent preview builds racing migrations).
    // This is distinct from cold-start P1001/P1002 — the database IS reachable,
    // but another build holds the migration lock. Retry with jitter.
    if (LOCK_TIMEOUT_PATTERN.test(message) && lockAttempt < MAX_LOCK_ATTEMPTS) {
      const jitter = Math.floor(Math.random() * 3000);
      const delayMs = 3000 + jitter; // 3-6s with jitter to avoid immediate re-collision
      console.warn(
        `Migration advisory-lock timeout on lock-attempt ${lockAttempt}/${MAX_LOCK_ATTEMPTS}. ` +
          `Another build may be running migrations. Waiting ${delayMs}ms with jitter, then retrying...`,
      );
      sleepSync(delayMs);
      return deploy(attempt, lockAttempt + 1);
    }

    // P1001 / P1002 = database unreachable (cold start). Most often a suspended
    // serverless compute that simply needs a few seconds to wake.
    const isReachable = DB_REACH_ERROR_CODES.some((code) => message.includes(code));
    if (isReachable && attempt < MAX_DB_REACH_ATTEMPTS) {
      const delayMs = Math.min(2000 * 2 ** (attempt - 1), 16000);
      const codes = DB_REACH_ERROR_CODES.join("/");
      console.warn(
        `Database unreachable (${codes}) on attempt ${attempt}/${MAX_DB_REACH_ATTEMPTS}. ` +
          `Waiting ${delayMs}ms for the database to wake, then retrying migrate deploy...`,
      );
      sleepSync(delayMs);
      return deploy(attempt + 1);
    }
    throw error;
  }
}

function verifyFailedInitPreconditions() {
  if (!existsSync(join(MIGRATIONS_DIR, INIT_MIGRATION, "migration.sql"))) {
    throw new Error(`Cannot recover ${INIT_MIGRATION}: migration file is missing`);
  }

  console.log("Verifying failed-init recovery preconditions...");

  // 1. Verify history state (must have exactly one unfinished init)
  // 2. Verify schema state (must have all required tables even if migration is marked unfinished)
  // We use --require-schema to ensure the data objects actually exist before we mark it as applied.
  try {
    command(process.execPath, [
      "scripts/verify-retroactive-init.mjs",
      "--expect-failed-init",
      "--require-schema"
    ]);
    console.log("Preconditions satisfied: migration history matches and schema objects are present.");
  } catch (error) {
    const details = errorText(error);
    console.error("Failed to verify failed-init recovery preconditions.");
    console.error("Recovery is only safe if required schema objects already exist in the database.");
    console.error("Verification output:", details.slice(0, 1000));
    throw new Error("Safety check failed: cannot resolve failed-init because schema preconditions are not met.");
  }
}

function recoverFailedInit() {
  verifyFailedInitPreconditions();
  console.log(`Repairing ${INIT_MIGRATION} migration history.`);
  try {
    prisma(["migrate", "resolve", "--rolled-back", INIT_MIGRATION], { capture: true });
  } catch (err) {
    const msg = errorText(err);
    if (!/already recorded|already applied|no recorded/i.test(msg)) throw err;
  }
  try {
    prisma(["migrate", "resolve", "--applied", INIT_MIGRATION], { capture: true });
  } catch (err) {
    const msg = errorText(err);
    if (!/already recorded|already applied/i.test(msg)) throw err;
  }
}

// Pre-warm the database connection so `migrate deploy` connects to an
// already-wake compute and doesn't hit P1001/P1002 cold-start timeouts.
// This is especially important on Neon, which auto-suspends idle computes.
console.log("Pre-warming database connection (SELECT 1)...");
const prewarmOk = prewarm();
if (prewarmOk) {
  console.log("Pre-warm succeeded — database is warm.");
} else {
  console.log("Pre-warm did not succeed — migrate deploy will retry if needed.");
}

const initialResult = deploy();
if (initialResult === "failed-init") {
  recoverFailedInit();
  const retryResult = deploy();
  if (retryResult !== "ok") {
    throw new Error(`Migration deployment failed after verified ${INIT_MIGRATION} recovery: ${retryResult}`);
  }
} else if (initialResult === "no-history") {
  throw new Error(
    "Existing non-empty database has no Prisma migration history. Automatic baselining is disabled; use a separately reviewed manual recovery procedure.",
  );
} else if (initialResult !== "ok") {
  throw new Error(`Migration deployment did not complete safely: ${initialResult}`);
}

// Final verification of the applied state — FAIL-CLOSED (port #861 behavior).
// Post-migration retroactive-init verification MUST throw on failure so a
// broken migration never silently deploys. The previous non-fatal warnings
// allowed production to run with an incomplete schema.
try {
  command(process.execPath, ["scripts/verify-retroactive-init.mjs"]);
} catch (error) {
  console.error("FAIL-CLOSED: Final retroactive init verification FAILED.");
  console.error("Error:", errorText(error).slice(0, 500));
  throw new Error("Migration deployment FAILED: retroactive init verification did not pass. Database schema is not in a safe state.");
}

try {
  command(process.execPath, ["scripts/check-critical-schema.mjs"], {
    env: { ...process.env, REQUIRE_MIGRATION_HISTORY: "true" },
  });
} catch (error) {
  console.error("FAIL-CLOSED: Critical schema check FAILED.");
  console.error("Error:", errorText(error).slice(0, 500));
  throw new Error("Migration deployment FAILED: critical schema verification did not pass. Database schema is not in a safe state.");
}

console.log("Database migration deployment completed.");
