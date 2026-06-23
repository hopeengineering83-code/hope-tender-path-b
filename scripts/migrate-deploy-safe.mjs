import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");
const INIT_MIGRATION = "20260601000000_init";
const allowPreviewMigrations = ["1", "true", "yes"].includes(
  String(process.env.ALLOW_PREVIEW_DB_MIGRATIONS ?? "").trim().toLowerCase(),
);

const isVercelPreview = process.env.VERCEL === "1" && process.env.VERCEL_ENV === "preview";

// ── Preview safety policy ──────────────────────────────────────────────
// A preview build that skips migrations is BUILD-ONLY — it is NOT
// database-verified. This is the correct default: preview builds should
// not mutate shared databases.
//
// When ALLOW_PREVIEW_DB_MIGRATIONS=true is set, the caller asserts they
// have configured an ISOLATED preview database (not the production
// database). We enforce this by requiring the preview DATABASE_URL to
// differ from any production DATABASE_URL that may be present in the
// environment. If they match, we fail closed — a preview migration must
// never touch the production database.
if (isVercelPreview && !allowPreviewMigrations) {
  console.warn("Skipping database migrations by preview safety policy.");
  console.warn(
    "This preview is build-only and is not database-verified. Configure an isolated preview database and set ALLOW_PREVIEW_DB_MIGRATIONS=true to enable preview migrations.",
  );
  process.exit(0);
}

if (isVercelPreview && allowPreviewMigrations) {
  // Require an isolated preview database. The preview DATABASE_URL must
  // NOT match a production DATABASE_URL if one is present (e.g. via
  // PREVIEW_DATABASE_URL or a known production pattern). This prevents
  // a misconfigured preview from running migrations against production.
  const previewDbUrl = process.env.DATABASE_URL ?? "";
  const prodDbUrl = process.env.PRODUCTION_DATABASE_URL ?? "";
  if (prodDbUrl && previewDbUrl && prodDbUrl === previewDbUrl) {
    throw new Error(
      "Preview migrations are enabled (ALLOW_PREVIEW_DB_MIGRATIONS=true) but DATABASE_URL matches PRODUCTION_DATABASE_URL. " +
        "Preview migrations require an ISOLATED preview database — refusing to migrate a production database from a preview build.",
    );
  }
  // Warn (but allow) if no PRODUCTION_DATABASE_URL is set — the caller
  // is responsible for ensuring isolation in that case.
  if (!prodDbUrl) {
    console.warn(
      "WARNING: ALLOW_PREVIEW_DB_MIGRATIONS=true but no PRODUCTION_DATABASE_URL is set for isolation comparison. " +
        "Ensure DATABASE_URL points to an isolated preview database — not production.",
    );
  }
  console.log("Preview migrations enabled — running migration deploy against the preview database.");
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
// connect timeout and surface as `P1001: Can't reach database server`. A single
// failed attempt then kills the entire Vercel build. Retry a few times with
// exponential backoff so the database has time to wake before we give up.
const MAX_DB_REACH_ATTEMPTS = 5;

function sleepSync(ms) {
  // Synchronous, dependency-free sleep. Atomics.wait is permitted on the main
  // thread in Node.js (unlike browsers) and avoids a busy-wait spin.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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
    // P1001 = database unreachable. Most often a suspended serverless compute
    // that simply needs a few seconds to wake — retry before failing the build.
    if (message.includes("P1001") && attempt < MAX_DB_REACH_ATTEMPTS) {
      const delayMs = Math.min(2000 * 2 ** (attempt - 1), 16000);
      console.warn(
        `Database unreachable (P1001) on attempt ${attempt}/${MAX_DB_REACH_ATTEMPTS}. ` +
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

// ── Final verification — FAIL CLOSED ────────────────────────────────────
// PR #757 introduced `console.warn` swallows here that converted
// verification failures into successful build exits. That meant a
// migration could "succeed" while the schema was actually broken
// (drift, missing tables, missing functions). These checks MUST fail
// the build — no exception swallowing, no console.warn, no
// process.exit(0). If the schema is wrong, the deploy is wrong.
console.log("Running post-migration verification (fail-closed)...");

// 1. Retroactive-init verification — confirms zero unfinished migrations
//    and that the init migration's checksum matches the file on disk.
try {
  command(process.execPath, ["scripts/verify-retroactive-init.mjs"]);
} catch (error) {
  const detail = errorText(error);
  console.error("Post-migration retroactive-init verification FAILED.");
  console.error("Output:", detail.slice(0, 2000));
  throw new Error(
    "Post-migration verification failed: retroactive-init check reported failures. " +
      "The migration deploy cannot be trusted. See output above.",
  );
}

// 2. Critical-schema verification — confirms required tables, columns,
//    functions, and migration history are all present and clean.
try {
  command(process.execPath, ["scripts/check-critical-schema.mjs"], {
    env: { ...process.env, REQUIRE_MIGRATION_HISTORY: "true" },
  });
} catch (error) {
  const detail = errorText(error);
  console.error("Post-migration critical-schema verification FAILED.");
  console.error("Output:", detail.slice(0, 2000));
  throw new Error(
    "Post-migration verification failed: critical-schema check reported failures. " +
      "The migration deploy cannot be trusted. See output above.",
  );
}

// 3. Zero-drift schema comparison — confirms the database schema exactly
//    matches the Prisma schema file. This is the authoritative drift
//    check. Credential-safe: DATABASE_URL stays in env, never on CLI.
console.log("Running credential-safe zero-drift schema comparison...");
try {
  prisma(
    [
      "migrate", "diff",
      "--from-schema-datasource", "prisma/schema.prisma",
      "--to-schema-datamodel", "prisma/schema.prisma",
      "--exit-code",
    ],
    { capture: true },
  );
} catch (error) {
  const detail = errorText(error);
  // prisma migrate diff exits with code 2 when there IS a difference
  // (drift). exit-code 0 means no difference. Any other error is a
  // tool failure. Both must fail the deploy.
  if (/drift|differ|exit code 2/i.test(detail)) {
    console.error("Post-migration zero-drift schema comparison FAILED: schema drift detected.");
    console.error("Output:", detail.slice(0, 2000));
    throw new Error(
      "Post-migration verification failed: prisma migrate diff detected schema drift between the database and prisma/schema.prisma. " +
        "The migration deploy did not produce a schema that matches the Prisma model. See output above.",
    );
  }
  console.error("Post-migration zero-drift schema comparison FAILED: tool error.");
  console.error("Output:", detail.slice(0, 2000));
  throw new Error(
    "Post-migration verification failed: prisma migrate diff could not complete. " +
      "The migration deploy cannot be trusted. See output above.",
  );
}

console.log("Database migration deployment completed — all verification checks passed.");
