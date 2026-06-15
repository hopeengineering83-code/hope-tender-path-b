import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");
const BASELINE_CUTOFF = process.env.PRISMA_BASELINE_CUTOFF || "20260613190000_comprehensive_gap_guards";
const explicitBaseline = ["1", "true", "yes"].includes((process.env.PRISMA_BASELINE_EXISTING_DB || "").trim().toLowerCase());

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
    return true;
  } catch (error) {
    const message = capturedErrorText(error);
    if (!message.includes("P3005") && !message.includes("database schema is not empty")) throw error;
    console.warn("Detected an existing database without Prisma migration history; evaluating controlled baseline policy.");
    return false;
  }
}

if (!deploy()) {
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

  if (!deploy()) throw new Error("Prisma migration deployment still failed after controlled baseline");
}

const guardFile = join(MIGRATIONS_DIR, "20260613190000_comprehensive_gap_guards", "migration.sql");
if (existsSync(guardFile)) {
  console.log("Reapplying idempotent database guard definitions.");
  prisma(["db", "execute", "--file", guardFile, "--schema", "prisma/schema.prisma"]);
}

console.log("Database migration deployment completed.");
