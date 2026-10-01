// EXECUTED backup/restore rehearsal — evidence level B, not a source inspection.
//
// tests/backup-restore-rehearsal-evidence.test.ts asserts that
// scripts/rehearse-backup-restore.sh *contains* pg_dump, psql, a drift check and
// so on. That is a static contract check: it proves the script is written, never
// that a backup taken from this schema can actually be restored and come back
// byte-identical. A dump that silently drops rows, loses a column default, or
// restores into a drifted schema would pass every one of those assertions.
//
// This test performs the rehearsal for real against ephemeral databases:
//
//   1. Seed representative rows across the critical tables (a full tender
//      workspace: user → company → vault document → tender → files → AI job →
//      analyze chunks → requirements).
//   2. Record BEFORE evidence: per-table row counts and a deterministic
//      per-table content checksum.
//   3. pg_dump the source.
//   4. Restore into a freshly created, empty target database.
//   5. Verify every critical table exists in the target.
//   6. Verify AFTER counts and checksums are IDENTICAL to BEFORE (zero drift).
//   7. Verify the restored schema carries the same column definitions, so a
//      restore cannot quietly lose defaults, nullability or types.
//
// Never touches Production: it refuses to run unless both URLs are local
// ephemeral databases, and the target is created and dropped by this test.

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const RUN_DB = process.env.RUN_DB_INTEGRATION === "true";
const SOURCE_URL = process.env.DATABASE_URL ?? "";

/**
 * Fail-closed safety: a rehearsal must never be able to touch a managed or
 * production database, and must never restore INTO one.
 */
function isEphemeralLocalUrl(url: string): boolean {
  if (!url) return false;
  if (/neon\.tech|supabase|rds\.amazonaws|azure|prod/i.test(url)) return false;
  return /@(127\.0\.0\.1|localhost)[:/]/.test(url);
}

const CAN_RUN = RUN_DB && isEphemeralLocalUrl(SOURCE_URL);

/** Tables whose contents must survive a backup/restore cycle unchanged. */
const CRITICAL_TABLES = [
  "User",
  "Company",
  "CompanyDocument",
  "Tender",
  "TenderFile",
  "AiJob",
  "AiAnalyzeChunk",
  "TenderRequirement",
] as const;

function parseUrl(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port || "5432",
    user: decodeURIComponent(u.username || "postgres"),
    password: decodeURIComponent(u.password || ""),
    database: u.pathname.replace(/^\//, ""),
  };
}

const source = CAN_RUN ? parseUrl(SOURCE_URL) : null;

// The rehearsal runs against its OWN source database, not the shared test
// database. The full suite executes many files concurrently against
// DATABASE_URL, so snapshotting shared tables would measure a moving target:
// another file inserting a User between the BEFORE snapshot and the dump would
// fail the comparison for reasons that have nothing to do with backup fidelity.
// An isolated source makes the before/after comparison exact and deterministic.
const REHEARSAL_ID = randomUUID().replace(/-/g, "").slice(0, 12);
const SOURCE_DB = `rehearsal_src_${REHEARSAL_ID}`;
const TARGET_DB = `rehearsal_tgt_${REHEARSAL_ID}`;

function sourceDbUrl(): string {
  const s = source!;
  const auth = s.password ? `${encodeURIComponent(s.user)}:${encodeURIComponent(s.password)}` : encodeURIComponent(s.user);
  return `postgresql://${auth}@${s.host}:${s.port}/${SOURCE_DB}?schema=public`;
}

function pgEnv(password: string): NodeJS.ProcessEnv {
  return password ? { ...process.env, PGPASSWORD: password } : { ...process.env };
}

function psqlOn(database: string, sql: string): string {
  const s = source!;
  return execFileSync(
    "psql",
    ["-h", s.host, "-p", s.port, "-U", s.user, "-d", database, "-tAc", sql],
    { env: pgEnv(s.password), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  ).trim();
}

/**
 * Deterministic content fingerprint for a table: every row rendered to text,
 * ordered, hashed as a set. Detects lost/changed/reordered-content rows, not
 * merely a differing count.
 */
function tableChecksum(database: string, table: string): string {
  return psqlOn(
    database,
    `SELECT COALESCE(md5(string_agg(row_fingerprint, '' ORDER BY row_fingerprint)), 'EMPTY')
       FROM (SELECT md5(t::text) AS row_fingerprint FROM "${table}" t) s`,
  );
}

function tableCount(database: string, table: string): number {
  return Number(psqlOn(database, `SELECT count(*) FROM "${table}"`));
}

/** Column definitions, so a restore cannot silently lose a default or nullability. */
function columnDefinitions(database: string, table: string): string {
  return psqlOn(
    database,
    `SELECT string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || COALESCE(column_default, 'NULL'), ',' ORDER BY column_name)
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = '${table}'`,
  );
}

describe("EXECUTED backup/restore rehearsal (evidence B)", { skip: !CAN_RUN }, () => {
  before(async () => {
    const s = source!;

    // ─── Create the isolated source and load the real schema into it ──────
    execFileSync("createdb", ["-h", s.host, "-p", s.port, "-U", s.user, SOURCE_DB], { env: pgEnv(s.password) });
    const schemaOnly = execFileSync(
      "pg_dump",
      ["-h", s.host, "-p", s.port, "-U", s.user, "-d", s.database, "--schema-only", "--no-owner", "--no-privileges"],
      { env: pgEnv(s.password), encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
    );
    execFileSync(
      "psql",
      ["-h", s.host, "-p", s.port, "-U", s.user, "-d", SOURCE_DB, "-v", "ON_ERROR_STOP=1", "-f", "-"],
      { env: pgEnv(s.password), input: schemaOnly, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
    );

    // ─── Seed a representative tender workspace into the isolated source ──
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient({ datasources: { db: { url: sourceDbUrl() } } });
    const bcrypt = (await import("bcryptjs")).default;

    const user = await prisma.user.create({
      data: {
        email: `rehearsal-${randomUUID().slice(0, 8)}@example.test`,
        passwordHash: await bcrypt.hash("Rehearsal-password-2026!", 10),
        role: "ADMIN",
        name: "Rehearsal Owner",
      },
    });

    const company = await prisma.company.create({
      data: { userId: user.id, name: "Rehearsal Co", legalName: "Rehearsal Co Ltd", setupCompletedAt: new Date() },
    });
    await prisma.companyDocument.create({
      data: {
        companyId: company.id,
        originalFileName: "iso9001.pdf",
        fileName: "iso9001.pdf",
        category: "CERTIFICATE",
        mimeType: "application/pdf",
        size: 2048,
        extractedText: "ISO 9001:2015 certificate held by Rehearsal Co Ltd.",
      },
    });

    const tender = await prisma.tender.create({
      data: {
        userId: user.id,
        title: "Rehearsal Tender — Supply of Equipment",
        description: "Representative tender used to prove backup/restore fidelity.",
        clientName: "Ministry of Works",
        files: {
          create: [{
            originalFileName: "itb.pdf",
            fileName: "itb.pdf",
            mimeType: "application/pdf",
            size: 8192,
            extractedText: "SECTION 1 — INSTRUCTIONS TO BIDDERS. Bids close on 30 June. Annex A lists required forms.",
            deletionStatus: "ACTIVE",
            contentSha256: "c".repeat(64),
            integrityStatus: "VERIFIED",
            extractionScore: 92,
            extractionMethod: "text",
            totalPages: 12,
          }],
        },
      },
    });

    const contentHash = "d".repeat(64);
    const job = await prisma.aiJob.create({
      data: {
        tenderId: tender.id,
        userId: user.id,
        jobType: "AI_ANALYZE",
        status: "SUCCEEDED",
        analysisInputHash: contentHash,
        runId: randomUUID(),
        promotedAt: new Date(),
        promotedBy: user.id,
        input: JSON.stringify({ source: "manual-ai-analyze", manualRequested: true, actorUserId: user.id }),
      },
    });
    await prisma.aiAnalyzeChunk.create({
      data: {
        tenderId: tender.id,
        userId: user.id,
        contentHash,
        chunkIndex: 0,
        totalChunks: 1,
        status: "SUCCEEDED",
        jobId: job.id,
        resultJson: JSON.stringify({ summary: "Rehearsal analysis", requirements: [] }),
      },
    });
    await prisma.tenderRequirement.create({
      data: {
        tenderId: tender.id,
        title: "Submit ISO 9001 certificate",
        description: "Bidders must provide a valid ISO 9001 certificate.",
        requirementType: "DOCUMENT",
        priority: "MANDATORY",
      },
    });

    await prisma.$disconnect();
  });

  after(async () => {
    // Both databases are created by this test, so cleanup is a plain drop —
    // no rows in the shared test database were touched.
    const s = source!;
    for (const db of [TARGET_DB, SOURCE_DB]) {
      try {
        execFileSync("dropdb", ["-h", s.host, "-p", s.port, "-U", s.user, "--if-exists", db], {
          env: pgEnv(s.password),
        });
      } catch {
        // Best-effort: these are ephemeral databases.
      }
    }
  });

  it("refuses to rehearse against a non-ephemeral database", () => {
    // The guard is what makes running this in CI safe.
    assert.equal(isEphemeralLocalUrl("postgresql://u:p@ep-cool-1.neon.tech/prod?sslmode=require"), false);
    assert.equal(isEphemeralLocalUrl("postgresql://u:p@db.production.internal:5432/app"), false);
    assert.equal(isEphemeralLocalUrl("postgresql://hope_ci@127.0.0.1:5432/hope_tender_ci?schema=public"), true);
  });

  it("backs up, restores into a clean database, and returns byte-identical data", () => {
    const s = source!;

    // ── BEFORE evidence ────────────────────────────────────────────────
    const before: Record<string, { count: number; checksum: string; columns: string }> = {};
    for (const table of CRITICAL_TABLES) {
      before[table] = {
        count: tableCount(SOURCE_DB, table),
        checksum: tableChecksum(SOURCE_DB, table),
        columns: columnDefinitions(SOURCE_DB, table),
      };
    }
    // The rehearsal is meaningless against empty tables.
    assert.ok(before.Tender.count > 0, "seed must have created tender rows to restore");
    assert.ok(before.AiJob.count > 0, "seed must have created AiJob rows to restore");
    assert.ok(before.TenderRequirement.count > 0, "seed must have created requirement rows to restore");

    // ── 1. Backup ──────────────────────────────────────────────────────
    const dump = execFileSync(
      "pg_dump",
      ["-h", s.host, "-p", s.port, "-U", s.user, "-d", SOURCE_DB, "--format=plain", "--no-owner", "--no-privileges"],
      { env: pgEnv(s.password), encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
    );
    assert.ok(dump.length > 0, "pg_dump must produce a non-empty backup");
    assert.match(dump, /CREATE TABLE public\."Tender"/, "backup must contain the Tender schema");
    assert.match(dump, /COPY public\."Tender"/, "backup must contain Tender data, not schema only");

    // ── 2. Restore into a freshly created, empty target ─────────────────
    execFileSync("createdb", ["-h", s.host, "-p", s.port, "-U", s.user, TARGET_DB], { env: pgEnv(s.password) });

    execFileSync(
      "psql",
      ["-h", s.host, "-p", s.port, "-U", s.user, "-d", TARGET_DB, "-v", "ON_ERROR_STOP=1", "-f", "-"],
      { env: pgEnv(s.password), input: dump, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
    );

    // ── 3. Every critical table must exist in the restored database ─────
    for (const table of CRITICAL_TABLES) {
      const exists = psqlOn(TARGET_DB, `SELECT to_regclass('public."${table}"') IS NOT NULL`);
      assert.equal(exists, "t", `restored database is missing critical table ${table}`);
    }

    // ── 4. Zero drift: counts, contents and column definitions ──────────
    for (const table of CRITICAL_TABLES) {
      const restoredCount = tableCount(TARGET_DB, table);
      assert.equal(
        restoredCount,
        before[table].count,
        `${table}: restored row count ${restoredCount} != original ${before[table].count}`,
      );

      const restoredChecksum = tableChecksum(TARGET_DB, table);
      assert.equal(
        restoredChecksum,
        before[table].checksum,
        `${table}: restored contents differ from the original (checksum mismatch)`,
      );

      const restoredColumns = columnDefinitions(TARGET_DB, table);
      assert.equal(
        restoredColumns,
        before[table].columns,
        `${table}: restored column definitions differ (a default, type or nullability was lost)`,
      );
    }
  });

  it("restores the seeded tender workspace with its relationships intact", () => {
    // Row counts matching is not proof the graph survived — verify the actual
    // relationships a recovery would depend on.
    const joined = psqlOn(
      TARGET_DB,
      `SELECT count(*) FROM "Tender" t
         JOIN "TenderFile" f ON f."tenderId" = t.id
         JOIN "AiJob" j ON j."tenderId" = t.id
         JOIN "TenderRequirement" r ON r."tenderId" = t.id
        WHERE t.title = 'Rehearsal Tender — Supply of Equipment'`,
    );
    assert.ok(Number(joined) > 0, "the restored tender must still join to its files, job and requirements");

    // A promoted analysis must survive as promoted — recovery must not silently
    // downgrade canonical authority.
    const promoted = psqlOn(
      TARGET_DB,
      `SELECT count(*) FROM "AiJob" WHERE "jobType" = 'AI_ANALYZE' AND "promotedAt" IS NOT NULL`,
    );
    assert.ok(Number(promoted) > 0, "a promoted AI_ANALYZE job must survive the restore as promoted");
  });
});
