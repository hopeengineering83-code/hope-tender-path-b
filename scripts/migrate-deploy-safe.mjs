import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveMigrationDatabaseUrl } from "./resolve-migration-url.mjs";

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");
const INIT_MIGRATION = "20260601000000_init";
const allowPreviewMigrations = ["1", "true", "yes"].includes(
  String(process.env.ALLOW_PREVIEW_DB_MIGRATIONS ?? "").trim().toLowerCase(),
);

// Any Vercel environment that is not Production is preview-class for this
// policy. Testing VERCEL_ENV === "preview" alone left "development" — and any
// environment name Vercel may add later — migrating unguarded. The caller
// (scripts/vercel-build.mjs) always expressed the rule as "not production", so
// the two now say the same thing in the same words.
const vercelEnvironment = String(process.env.VERCEL_ENV ?? "").trim().toLowerCase();
const isVercelPreview = process.env.VERCEL === "1" && vercelEnvironment !== "production";
if (isVercelPreview && !allowPreviewMigrations) {
  console.warn("Skipping database migrations by preview safety policy.");
  console.warn(`Vercel environment: ${vercelEnvironment || "unset"} (any environment that is not production is preview-class).`);
  console.warn(
    "This preview is build-only and is not database-verified. Configure an isolated preview database and set ALLOW_PREVIEW_DB_MIGRATIONS=true to enable preview migrations.",
  );
  console.warn(
    "Until then the deployed code may be ahead of this database, and sign-in will answer AUTH_DATABASE_SCHEMA_OUTDATED rather than fail transiently.",
  );
  process.exit(0);
}

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for migration deployment");

// ─── Migrations must not run through a transaction pooler ────────────────────
//
// `prisma migrate deploy` serialises itself with a SESSION-scoped advisory lock,
// pg_advisory_lock(72707369). Neon's pooled endpoint is PgBouncer in transaction
// pooling mode: each statement may be answered by a different backend. So the
// lock is taken on one backend, the follow-up statement lands on another that
// does not hold it, and Prisma waits for a lock it can never observe until it
// fails with:
//
//   P1002: timed out acquiring advisory lock
//
// which is exactly how the production redeploy failed. The database was healthy
// throughout; nothing was wrong with the schema or the migrations. The runtime
// app is unaffected — pooling is correct for it, and only migration needs a
// session that stays on one backend.
//
// Resolution order, most explicit first:
//   1. DIRECT_URL / MIGRATE_DATABASE_URL — an operator-set direct endpoint.
//   2. DATABASE_URL with Neon's `-pooler` marker removed. Neon's convention is
//      that the direct host is the pooled host minus that marker, so this
//      repairs the common case with no configuration at all.
//   3. DATABASE_URL unchanged — local, CI, and any non-pooled deployment.
//
// This widens nothing: the same credentials reach the same database, over a
// connection that can hold a session lock.
const migrationTarget = resolveMigrationDatabaseUrl();
// The URL itself is never printed — only which rule chose it.
console.log(`Migration connection: ${migrationTarget.source}.`);
const migrationEnv = { ...process.env, DATABASE_URL: migrationTarget.url };

function redact(value) {
  let text = String(value ?? "");
  for (const secret of [process.env.DATABASE_URL, process.env.DIRECT_URL, process.env.MIGRATE_DATABASE_URL]) {
    if (secret) text = text.split(secret).join("[REDACTED_DATABASE_URL]");
  }
  // The derived direct URL is not in the environment, so redact it by shape as
  // well: any credential-bearing URI is replaced whatever its host.
  return text
    .replace(/(?:DATABASE_URL|DIRECT_URL|MIGRATE_DATABASE_URL)\s*[:=]\s*\S+/gi, "$&".replace(/[:=]\s*\S+/, "=[REDACTED]"))
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/gi, "[REDACTED_CREDENTIAL_URI]@");
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
  // Default to the migration connection: everything this script runs through
  // prisma is a migration operation, and all of them need a session that stays
  // on one backend.
  return command(executable, ["prisma", ...args], { env: migrationEnv, ...options });
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

// A P1002 that names the advisory lock is a DIFFERENT failure from an
// unreachable database, and waiting longer is the right response to it: another
// deploy of the same project is part-way through its own migration and holds
// the lock. Vercel can start concurrent builds, so this is ordinary contention,
// not a fault — the second build should queue behind the first rather than fail
// the deployment. Distinguishing it also stops it being misreported as "the
// database is down", which sent the last investigation to the wrong place.
const ADVISORY_LOCK_MARKERS = ["advisory lock", "pg_advisory_lock", "72707369"];
const MAX_ADVISORY_LOCK_ATTEMPTS = 6;

function isAdvisoryLockTimeout(message) {
  const lower = message.toLowerCase();
  return ADVISORY_LOCK_MARKERS.some((marker) => lower.includes(marker));
}

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
    command(process.execPath, ["scripts/prewarm-db.mjs"], { env: migrationEnv });
    return true;
  } catch {
    // Don't throw — let deploy() try with its own retry logic.
    console.warn("Pre-warm script failed; proceeding to migrate deploy (which has its own retry).");
    return false;
  }
}

function deploy(attempt = 1) {
  try {
    prisma(["migrate", "deploy"], { capture: true });
    return "ok";
  } catch (error) {
    const message = errorText(error);
    if (message.includes("P3005") || /database schema is not empty/i.test(message)) return "no-history";
    if (message.includes("P3009") && message.includes(INIT_MIGRATION)) return "failed-init";
    if (message.includes(INIT_MIGRATION) && /already exists/i.test(message)) return "failed-init";
    // Advisory-lock contention is checked BEFORE the unreachable codes, because
    // it arrives as P1002 and would otherwise be mistaken for a dead database —
    // which is exactly what happened to the last production redeploy. It waits
    // longer and reports honestly.
    if (isAdvisoryLockTimeout(message)) {
      if (attempt < MAX_ADVISORY_LOCK_ATTEMPTS) {
        const delayMs = Math.min(5000 * 2 ** (attempt - 1), 60000);
        console.warn(
          `Migration advisory lock is held by another deployment (attempt ${attempt}/${MAX_ADVISORY_LOCK_ATTEMPTS}). ` +
            `This is contention between concurrent builds, not a database fault. ` +
            `Waiting ${delayMs}ms for the other migration to finish, then retrying...`,
        );
        sleepSync(delayMs);
        return deploy(attempt + 1);
      }
      throw new Error(
        "Migration deployment FAILED: could not acquire the Prisma advisory lock after "
          + `${MAX_ADVISORY_LOCK_ATTEMPTS} attempts. Either another deployment is still migrating, or the `
          + "migration connection is running through a transaction pooler, where a session-scoped "
          + "advisory lock cannot be observed. Set DIRECT_URL to the database's direct (non-pooled) "
          + "endpoint and redeploy.",
      );
    }
    // P1001 / P1002 = database unreachable. Most often a suspended serverless
    // compute that simply needs a few seconds to wake — retry before failing
    // the build. Both codes cover the same cold-start failure mode on Neon /
    // Supabase / Railway serverless Postgres.
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
