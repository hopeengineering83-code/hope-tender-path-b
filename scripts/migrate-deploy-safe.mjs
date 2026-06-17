import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");
const allowPreviewMigrations = ["1", "true", "yes"].includes((process.env.ALLOW_PREVIEW_DB_MIGRATIONS || "").trim().toLowerCase());
const INIT_MIGRATION = "20260601000000_init";

const isVercelPreview = process.env.VERCEL === "1" && process.env.VERCEL_ENV === "preview";
if (isVercelPreview && !allowPreviewMigrations) {
  console.warn("Skipping database migrations by preview safety policy.");
  console.warn("This preview is build-only and is not database-verified. Configure an isolated preview database and set ALLOW_PREVIEW_DB_MIGRATIONS=true to enable preview migrations.");
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for database migration deployment");
}

function redactSensitive(value) {
  let text = String(value ?? "");
  const configuredDatabaseUrl = process.env.DATABASE_URL;
  if (configuredDatabaseUrl) {
    text = text.split(configuredDatabaseUrl).join("[REDACTED_DATABASE_URL]");
  }
  return text.replace(/DATABASE_URL\s*[:=]\s*\S+/gi, "DATABASE_URL=[REDACTED]");
}

function emitCaptured(value, target) {
  if (!value) return;
  target.write(redactSensitive(value));
}

function command(commandName, args, { capture = false, env = process.env } = {}) {
  try {
    const output = execFileSync(commandName, args, {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    if (capture) emitCaptured(output, process.stdout);
    return output;
  } catch (error) {
    if (capture) {
      emitCaptured(error?.stdout, process.stdout);
      emitCaptured(error?.stderr, process.stderr);
    }
    throw error;
  }
}

function prisma(args, options = {}) {
  return command(process.platform === "win32" ? "npx.cmd" : "npx", ["prisma", ...args], options);
}

function capturedErrorText(error) {
  return redactSensitive(`${String(error?.stdout || "")}\n${String(error?.stderr || "")}\n${String(error?.message || "")}`);
}

function deploy() {
  try {
    prisma(["migrate", "deploy"], { capture: true });
    return "ok";
  } catch (error) {
    const message = capturedErrorText(error);

    if (message.includes("P3005") || message.includes("database schema is not empty")) {
      return "no-history";
    }

    if (message.includes("P3009") && message.includes(INIT_MIGRATION)) {
      return "failed-init";
    }

    if (message.includes(INIT_MIGRATION) && /already exists/i.test(message)) {
      return "failed-init";
    }

    throw error;
  }
}

function verifyFailedInitState() {
  const initDirectory = join(MIGRATIONS_DIR, INIT_MIGRATION);
  if (!existsSync(initDirectory)) {
    throw new Error(`Cannot repair ${INIT_MIGRATION}: migration directory is missing`);
  }

  command(process.execPath, ["scripts/verify-retroactive-init.mjs", "--expect-failed-init"]);
}

function resolveFailedInitMigration() {
  verifyFailedInitState();
  console.log(`Verified existing init structure and failed migration state for ${INIT_MIGRATION}.`);

  prisma(["migrate", "resolve", "--rolled-back", INIT_MIGRATION], { capture: true });
  prisma(["migrate", "resolve", "--applied", INIT_MIGRATION], { capture: true });
}

const initialResult = deploy();

if (initialResult === "failed-init") {
  resolveFailedInitMigration();
  const retryResult = deploy();
  if (retryResult !== "ok") {
    throw new Error(`Prisma migration deployment still failed after resolving ${INIT_MIGRATION} (result: ${retryResult})`);
  }
} else if (initialResult === "no-history") {
  throw new Error("Existing non-empty database has no Prisma migration history. Automatic baselining is disabled; use a separately reviewed manual recovery procedure.");
} else if (initialResult !== "ok") {
  throw new Error(`Prisma migration deployment did not complete safely (result: ${initialResult})`);
}

command(process.execPath, ["scripts/verify-retroactive-init.mjs"]);
command(process.execPath, ["scripts/check-critical-schema.mjs"], {
  env: { ...process.env, REQUIRE_MIGRATION_HISTORY: "true" },
});

console.log("Database migration deployment and structural verification completed.");
