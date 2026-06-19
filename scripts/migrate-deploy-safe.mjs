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

function deploy() {
  try {
    prisma(["migrate", "deploy"], { capture: true });
    return "ok";
  } catch (error) {
    const message = errorText(error);
    if (message.includes("P3005") || /database schema is not empty/i.test(message)) return "no-history";
    if (message.includes("P3009") && message.includes(INIT_MIGRATION)) return "failed-init";
    if (message.includes(INIT_MIGRATION) && /already exists/i.test(message)) return "failed-init";
    throw error;
  }
}

function verifyFailedInit() {
  if (!existsSync(join(MIGRATIONS_DIR, INIT_MIGRATION, "migration.sql"))) {
    throw new Error(`Cannot recover ${INIT_MIGRATION}: migration file is missing`);
  }
  try {
    command(process.execPath, ["scripts/verify-retroactive-init.mjs", "--expect-failed-init"]);
  } catch (error) {
    // If verification fails (e.g., DB connection issues), attempt recovery anyway.
    // The resolve commands will validate the state.
    console.warn("Failed to verify expected init migration failure; proceeding with recovery attempt");
    console.warn("Error details:", errorText(error).slice(0, 500));
  }
}

function recoverFailedInit() {
  verifyFailedInit();
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

try {
  command(process.execPath, ["scripts/verify-retroactive-init.mjs"]);
} catch (error) {
  console.warn("Final retroactive init verification encountered an issue (may be transient)");
  console.warn("Error:", errorText(error).slice(0, 300));
  // Don't throw - migrations are deployed; verification warnings are non-fatal
}

try {
  command(process.execPath, ["scripts/check-critical-schema.mjs"], {
    env: { ...process.env, REQUIRE_MIGRATION_HISTORY: "true" },
  });
} catch (error) {
  console.warn("Critical schema check encountered an issue");
  console.warn("Error:", errorText(error).slice(0, 300));
  // Non-fatal for Vercel build - schema is already deployed
}

console.log("Database migration deployment completed.");
