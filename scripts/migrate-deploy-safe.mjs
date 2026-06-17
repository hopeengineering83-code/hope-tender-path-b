import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");
const BASELINE_CUTOFF = process.env.PRISMA_BASELINE_CUTOFF || "20260613190000_comprehensive_gap_guards";
const explicitBaseline = ["1", "true", "yes"].includes((process.env.PRISMA_BASELINE_EXISTING_DB || "").trim().toLowerCase());
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

const ALLOW_BASELINE = explicitBaseline;

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

function migrationNames() {
  if (!existsSync(MIGRATIONS_DIR)) throw new Error("prisma/migrations directory is missing");
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => statSync(join(MIGRATIONS_DIR, name)).isDirectory())
    .sort();
}

function schemaMatchesCurrentPrismaModel() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for schema verification");

  try {
    prisma([
      "migrate",
      "diff",
      "--from-schema-datasource",
      "prisma/schema.prisma",
      "--to-schema-datamodel",
      "prisma/schema.prisma",
      "--exit-code",
    ], { capture: true });
    return true;
  } catch (error) {
    const status = Number(error?.status ?? error?.code ?? 1);
    if (status === 2) {
      console.error("Database schema differs from prisma/schema.prisma. Refusing automatic migration-history repair.");
      return false;
    }
    console.error("Database schema verification could not complete.");
    throw new Error("Database schema verification failed without changing migration history");
  }
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

    const failedInit = message.includes("P3009") && message.includes(INIT_MIGRATION);
    if (failedInit) {
      return "failed-init";
    }

    const initConflict = message.includes(INIT_MIGRATION) && /already exists/i.test(message);
    if (initConflict) {
      return "failed-init";
    }

    throw error;
  }
}

function resolveFailedInitMigration() {
  if (!existsSync(join(MIGRATIONS_DIR, INIT_MIGRATION))) {
    throw new Error(`Cannot repair ${INIT_MIGRATION}: migration directory is missing`);
  }

  const schemaVerified = schemaMatchesCurrentPrismaModel();
  if (!schemaVerified) {
    throw new Error(`Refusing to resolve ${INIT_MIGRATION}: production schema does not match prisma/schema.prisma`);
  }

  console.log(`Schema matches Prisma. Resolving failed retroactive migration ${INIT_MIGRATION}.`);

  try {
    prisma(["migrate", "resolve", "--rolled-back", INIT_MIGRATION], { capture: true });
  } catch (error) {
    const text = capturedErrorText(error);
    if (!/already.*rolled back|not in a failed state|was not found/i.test(text)) throw error;
  }

  try {
    prisma(["migrate", "resolve", "--applied", INIT_MIGRATION], { capture: true });
  } catch (error) {
    const text = capturedErrorText(error);
    if (!/already recorded|already applied/i.test(text)) throw error;
  }
}

function baselineExistingDatabase() {
  if (!ALLOW_BASELINE) {
    console.error("ERROR: Existing non-empty database has no Prisma migration history.");
    console.error("Automatic baselining is disabled. Set PRISMA_BASELINE_EXISTING_DB=true only after an operator has reviewed the target database.");
    process.exit(1);
  }

  const schemaVerified = schemaMatchesCurrentPrismaModel();
  if (!schemaVerified) {
    throw new Error("Refusing controlled baseline: database schema does not match prisma/schema.prisma");
  }

  const historical = migrationNames().filter((name) => name <= BASELINE_CUTOFF);
  if (historical.length === 0 || !historical.includes(BASELINE_CUTOFF)) {
    throw new Error(`Baseline cutoff ${BASELINE_CUTOFF} was not found in prisma/migrations`);
  }

  console.log(`Baselining ${historical.length} verified historical migration(s) through ${BASELINE_CUTOFF}.`);
  for (const name of historical) {
    try {
      prisma(["migrate", "resolve", "--applied", name], { capture: true });
    } catch (error) {
      const text = capturedErrorText(error);
      if (!/already recorded|already applied/i.test(text)) throw error;
    }
  }
}

const initialResult = deploy();

if (initialResult === "failed-init") {
  resolveFailedInitMigration();
  const retryResult = deploy();
  if (retryResult !== "ok") {
    throw new Error(`Prisma migration deployment still failed after resolving ${INIT_MIGRATION} (result: ${retryResult})`);
  }
} else if (initialResult === "no-history") {
  baselineExistingDatabase();
  const retryResult = deploy();
  if (retryResult !== "ok") {
    throw new Error(`Prisma migration deployment still failed after controlled baseline (result: ${retryResult})`);
  }
} else if (initialResult !== "ok") {
  throw new Error(`Prisma migration deployment did not complete safely (result: ${initialResult})`);
}

command(process.execPath, ["scripts/check-critical-schema.mjs"], {
  env: { ...process.env, REQUIRE_MIGRATION_HISTORY: "true" },
});

console.log("Database migration deployment and critical-schema verification completed.");
