import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");
const BASELINE_CUTOFF = process.env.PRISMA_BASELINE_CUTOFF || "20260613190000_comprehensive_gap_guards";
const explicitBaseline = ["1", "true", "yes"].includes((process.env.PRISMA_BASELINE_EXISTING_DB || "").trim().toLowerCase());

// The retroactively-added init migration. When a production DB already has all
// tables (set up before migration tracking was introduced), Prisma will try to
// apply this migration first and fail with "already exists". In that case we
// mark it as applied so _prisma_migrations accurately reflects reality.
const INIT_MIGRATION = "20260601000000_init";

// In Vercel PREVIEW builds where DATABASE_URL is not configured, skip migrations
// gracefully. The app bootstrap (lib/prisma.ts) handles schema on first request.
// In production and CI (DATABASE_URL always set), migrations always run.
const isVercelPreview = process.env.VERCEL === "1" && process.env.VERCEL_ENV === "preview";
if (isVercelPreview && !process.env.DATABASE_URL) {
  console.warn("Skipping migrations: Vercel preview build with no DATABASE_URL configured.");
  console.warn("Set DATABASE_URL in Vercel project settings (Settings → Environment Variables → Preview) to run migrations on preview deployments.");
  process.exit(0);
}

// PR XX-G13 — remove automatic baselining based on VERCEL_ENV or neon.tech URL.
// Explicit confirmation via PRISMA_BASELINE_EXISTING_DB=true is now required.
const ALLOW_BASELINE = explicitBaseline;

function emitCaptured(value, target) {
  if (!value) return;
  target.write(String(value));
}

function prisma(args, { capture = false } = {}) {
  try {
    const output = execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["prisma", ...args], {
      cwd: process.cwd(),
      env: process.env,
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

function capturedErrorText(error) {
  return `${String(error?.stdout || "")}\n${String(error?.stderr || "")}\n${String(error?.message || "")}`;
}

function migrationNames() {
  if (!existsSync(MIGRATIONS_DIR)) throw new Error("prisma/migrations directory is missing");
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => statSync(join(MIGRATIONS_DIR, name)).isDirectory())
    .sort();
}

function deploy() {
  try {
    prisma(["migrate", "deploy"], { capture: true });
    return "ok";
  } catch (error) {
    const message = capturedErrorText(error);
    if (message.includes("P3005") || message.includes("database schema is not empty")) {
      console.warn("Detected an existing database without Prisma migration history; evaluating controlled baseline policy.");
      return "no-history";
    }
    // "already exists" means a retroactively-added init migration is being applied
    // to a database that already has the tables. The schema is already correct;
    // only _prisma_migrations needs to be updated to record this migration.
    if (message.includes("already exists")) {
      console.warn("Detected existing schema conflict during migration apply; evaluating init migration resolution.");
      return "schema-conflict";
    }
    throw error;
  }
}

let deployResult = deploy();

if (deployResult === "no-history") {
  // Vercel preview deployments with a bootstrapped DB (no migration history)
  // should not block the build. Preview DBs are often created via db push or
  // without migration tracking; failing here prevents all preview deployments.
  if (isVercelPreview) {
    console.warn("Skipping migration baseline for Vercel preview: DB has no Prisma migration history.");
    console.warn("Set PRISMA_BASELINE_EXISTING_DB=true to run a controlled baseline on preview.");
    process.exit(0);
  }

  if (!ALLOW_BASELINE) {
    console.error("ERROR: Existing non-empty database has no Prisma migration history.");
    console.error("Automatic baselining is disabled for security. Set PRISMA_BASELINE_EXISTING_DB=true to authorize.");
    process.exit(1);
  }

  const historical = migrationNames().filter((name) => name <= BASELINE_CUTOFF);
  if (historical.length === 0 || !historical.includes(BASELINE_CUTOFF)) {
    throw new Error(`Baseline cutoff ${BASELINE_CUTOFF} was not found in prisma/migrations`);
  }

  console.log(`Baselining ${historical.length} historical migration(s) through ${BASELINE_CUTOFF}.`);
  for (const name of historical) {
    try {
      prisma(["migrate", "resolve", "--applied", name], { capture: true });
    } catch (error) {
      const text = capturedErrorText(error);
      if (!/already recorded|already applied/i.test(text)) throw error;
    }
  }

  deployResult = deploy();
  if (deployResult !== "ok") throw new Error(`Prisma migration deployment still failed after controlled baseline (result: ${deployResult})`);
}

if (deployResult === "schema-conflict") {
  // The init migration was retroactively added to a database whose schema was
  // already set up before migration tracking was introduced (via prisma db push
  // or a prior deploy). All the tables already exist; we just need to record
  // the init migration as applied so _prisma_migrations reflects reality.
  if (!existsSync(join(MIGRATIONS_DIR, INIT_MIGRATION))) {
    throw new Error(`Schema conflict during deploy but init migration ${INIT_MIGRATION} not found in prisma/migrations`);
  }
  console.log(`Marking retroactive init migration ${INIT_MIGRATION} as applied to sync migration history.`);
  try {
    prisma(["migrate", "resolve", "--applied", INIT_MIGRATION], { capture: true });
  } catch (error) {
    const text = capturedErrorText(error);
    if (!/already recorded|already applied/i.test(text)) throw error;
  }
  deployResult = deploy();
  if (deployResult !== "ok") throw new Error(`Prisma migration deployment still failed after resolving init migration schema conflict (result: ${deployResult})`);
}

const guardFile = join(MIGRATIONS_DIR, "20260613190000_comprehensive_gap_guards", "migration.sql");
if (existsSync(guardFile)) {
  console.log("Reapplying idempotent database guard definitions.");
  prisma(["db", "execute", "--file", guardFile, "--schema", "prisma/schema.prisma"]);
}

console.log("Database migration deployment completed.");
