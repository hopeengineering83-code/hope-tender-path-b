import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");
const BASELINE_CUTOFF = process.env.PRISMA_BASELINE_CUTOFF || "20260613190000_comprehensive_gap_guards";
const explicitBaseline = ["1", "true", "yes"].includes((process.env.PRISMA_BASELINE_EXISTING_DB || "").trim().toLowerCase());
const knownVercelDatabase = Boolean(
  process.env.VERCEL_ENV &&
  process.env.DATABASE_URL?.includes("neon.tech") &&
  BASELINE_CUTOFF === "20260613190000_comprehensive_gap_guards",
);
const ALLOW_BASELINE = explicitBaseline || knownVercelDatabase;

function prisma(args, options = {}) {
  return execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["prisma", ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

function migrationNames() {
  if (!existsSync(MIGRATIONS_DIR)) throw new Error("prisma/migrations directory is missing");
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => statSync(join(MIGRATIONS_DIR, name)).isDirectory())
    .sort();
}

function deploy() {
  try {
    prisma(["migrate", "deploy"]);
    return true;
  } catch (error) {
    const stdout = String(error?.stdout || "");
    const stderr = String(error?.stderr || "");
    const message = `${stdout}\n${stderr}\n${error?.message || ""}`;
    if (!message.includes("P3005") && !message.includes("database schema is not empty")) throw error;
    return false;
  }
}

if (!deploy()) {
  if (!ALLOW_BASELINE) {
    throw new Error(
      "Existing non-empty database has no Prisma migration history. Explicitly authorize the verified baseline through " + BASELINE_CUTOFF,
    );
  }

  const historical = migrationNames().filter((name) => name <= BASELINE_CUTOFF);
  if (historical.length === 0 || !historical.includes(BASELINE_CUTOFF)) {
    throw new Error(`Baseline cutoff ${BASELINE_CUTOFF} was not found in prisma/migrations`);
  }

  console.log(`Baselining ${historical.length} historical migration(s) through ${BASELINE_CUTOFF}.`);
  for (const name of historical) {
    try {
      prisma(["migrate", "resolve", "--applied", name]);
    } catch (error) {
      const text = `${error?.stdout || ""}\n${error?.stderr || ""}\n${error?.message || ""}`;
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
