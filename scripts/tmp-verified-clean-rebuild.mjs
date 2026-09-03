// TEMPORARY — one-time verified clean rebuild of the new Preview database
// (fingerprint d74f2ac75c88). Removed as part of cleanup once the recovery
// is complete and verified healthy.
//
// Context: Phase 1/2 forensics (read-only, see scripts/tmp-schema-structural-
// snapshot.sh and the migrate-preview-db job) proved this database's schema
// does not correspond to any prefix of this repository's 51 Prisma
// migrations. Root cause: it was built by lib/prisma.ts's legacy
// isRuntimeSchemaBootstrapEnabled() / bootstrap() path (ad-hoc
// CREATE TABLE IF NOT EXISTS using TIMESTAMPTZ, missing many later-migration
// columns) rather than by `prisma migrate deploy` — that path runs whenever
// NODE_ENV !== "production", which is how a non-production process touching
// this then-new Neon database first created its schema. That function also
// seeds exactly 4 canonical Role rows (lib/prisma.ts's "seed roles" block),
// which matches this database's only non-empty table exactly.
//
// The owner explicitly authorized ONE destructive operation — DROP SCHEMA
// public CASCADE + CREATE SCHEMA public — against ONLY this specific,
// fingerprint-verified, business-data-empty Preview database, subject to the
// hard gates below. This script performs those gates and the reset; it does
// NOT run `prisma migrate deploy` itself (that stays a separate, ordinary
// step using the already-trusted npm run prisma:migrate:safe).
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL;
const EXPECTED_FINGERPRINT = process.env.EXPECTED_FINGERPRINT;
const SCHEMA_BACKUP_PATH = process.env.SCHEMA_BACKUP_PATH || "/tmp/preview-db-schema-only-backup.sql";

if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!EXPECTED_FINGERPRINT) throw new Error("EXPECTED_FINGERPRINT is required");

// ─── Gate 1: re-verify fingerprint (redundant with the workflow's own check,
// cheap insurance directly ahead of the destructive step) ───────────────────
function fingerprintOf(url) {
  const u = new URL(url);
  const db = u.pathname.replace(/^\/+/, "");
  return createHash("sha256").update(`${u.host}/${db}`).digest("hex").slice(0, 12);
}
const actualFingerprint = fingerprintOf(DATABASE_URL);
console.log("Re-confirmed target database fingerprint:", actualFingerprint);
if (actualFingerprint !== EXPECTED_FINGERPRINT) {
  console.error(`REFUSING TO RESET: fingerprint ${actualFingerprint} does not match expected ${EXPECTED_FINGERPRINT}.`);
  process.exit(1);
}

const CANONICAL_ROLES = [
  { id: "role-admin", code: "ADMIN", name: "Admin", description: "Full access" },
  { id: "role-proposal-manager", code: "PROPOSAL_MANAGER", name: "Proposal Manager", description: "Tender drafting and generation" },
  { id: "role-reviewer", code: "REVIEWER", name: "Reviewer", description: "Review and approval" },
  { id: "role-viewer", code: "VIEWER", name: "Viewer", description: "Read only" },
];

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  try {
    // ─── Gate 2: every business table must be genuinely empty ───────────────
    const tables = await prisma.$queryRawUnsafe(
      `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
    );
    const unexpected = [];
    let roleRows = [];
    for (const { table_name } of tables) {
      const safe = /^[A-Za-z0-9_]+$/.test(table_name);
      if (!safe) continue;
      const [{ n }] = await prisma.$queryRawUnsafe(`select count(*)::int as n from "${table_name}"`);
      if (table_name === "Role") {
        if (n > 0) {
          roleRows = await prisma.$queryRawUnsafe(
            `select id, code, name, description from "Role" order by code`,
          );
        }
        continue;
      }
      if (n > 0) unexpected.push(`${table_name}=${n}`);
    }
    if (unexpected.length > 0) {
      console.error("REFUSING TO RESET: found non-empty business/application table(s):", unexpected.join(", "));
      console.error("This does not match the pre-approved condition (all business tables must be 0 rows). Aborting.");
      process.exit(1);
    }
    console.log(`Gate 2 passed: every business/application table is empty. Role has ${roleRows.length} row(s).`);

    // ─── Gate 3: any existing Role rows must exactly match the repository's
    // own deterministic seed set (lib/prisma.ts) — never assume, only accept
    // rows that are provably the known fixed lookup data. ────────────────────
    if (roleRows.length > 0) {
      const matches =
        roleRows.length === CANONICAL_ROLES.length &&
        CANONICAL_ROLES.every((c) =>
          roleRows.some((r) => r.id === c.id && r.code === c.code && r.name === c.name && r.description === c.description),
        );
      console.log(`Gate 3: existing Role rows match the repository's deterministic seed set exactly: ${matches}`);
      if (!matches) {
        console.error("REFUSING TO RESET: existing Role rows do not exactly match the repository's known fixed lookup set.");
        console.error("Contents (non-sensitive lookup data):", JSON.stringify(roleRows));
        process.exit(1);
      }
    } else {
      console.log("Gate 3: Role table is empty — nothing to cross-check, canonical set will be (re)inserted after rebuild.");
    }

    // ─── Backup: schema-only, no data, no credentials. Rollback evidence for
    // the lifetime of this job only (the runner is destroyed afterward). ─────
    execFileSync("pg_dump", ["--schema-only", "--no-owner", "--no-privileges", "--file", SCHEMA_BACKUP_PATH, DATABASE_URL], {
      stdio: "inherit",
    });
    console.log(`Schema-only backup written to ${SCHEMA_BACKUP_PATH} (ephemeral runner file, no data, no credentials).`);
  } finally {
    await prisma.$disconnect();
  }

  // ─── The destructive step. Every gate above passed. ─────────────────────
  const prisma2 = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  try {
    console.log("All gates passed. Resetting the public schema (DROP SCHEMA public CASCADE; CREATE SCHEMA public;)...");
    await prisma2.$executeRawUnsafe(`DROP SCHEMA public CASCADE`);
    await prisma2.$executeRawUnsafe(`CREATE SCHEMA public`);
    console.log("Schema reset complete. The database is now genuinely empty, ready for prisma migrate deploy.");
  } finally {
    await prisma2.$disconnect();
  }
}

main().catch((err) => {
  console.error("Verified clean rebuild failed:", err.message);
  process.exit(1);
});
