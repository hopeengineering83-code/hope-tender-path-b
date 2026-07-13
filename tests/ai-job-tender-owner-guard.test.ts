import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PGlite } from "@electric-sql/pglite";

const RUN_DB_INTEGRATION = process.env.RUN_DB_INTEGRATION === "true";
const prisma = new PrismaClient();

function isOwnershipConstraintError(error: unknown): boolean {
  const candidate = error as { message?: string; code?: string; meta?: unknown };
  const text = `${candidate?.message ?? ""} ${candidate?.code ?? ""} ${JSON.stringify(candidate?.meta ?? {})}`;
  return /AI_JOB_TENDER_OWNER_MISMATCH|23514|constraint failed/i.test(text);
}

describe("AiJob tender ownership migration", () => {
  it("installs a fail-closed INSERT and UPDATE trigger without dynamic SQL", () => {
    const sql = readFileSync(
      "prisma/migrations/20260712193000_ai_job_tender_owner_guard/migration.sql",
      "utf8",
    );
    assert.match(sql, /CREATE OR REPLACE FUNCTION "enforce_ai_job_tender_owner"/);
    assert.match(sql, /NEW\."tenderId" IS NOT NULL/);
    assert.match(sql, /tender\."id" = NEW\."tenderId"/);
    assert.match(sql, /tender\."userId" = NEW\."userId"/);
    assert.match(sql, /BEFORE INSERT OR UPDATE OF "tenderId", "userId"/);
    assert.match(sql, /AI_JOB_TENDER_OWNER_MISMATCH/);
    assert.doesNotMatch(sql, /EXECUTE\s+format|EXECUTE\s+NEW|\|\|/i);
  });

  it("applies idempotently on disposable PostgreSQL (PGlite)", async () => {
    // The migration uses CREATE OR REPLACE FUNCTION and DROP TRIGGER IF EXISTS
    // before CREATE TRIGGER, so re-applying should not error. Verify this on
    // a disposable PostgreSQL instance.
    const db = new PGlite();
    try {
      // Create the AiJob and Tender tables (minimal shape for the trigger).
      await db.exec(`
        CREATE TABLE "Tender" (
          "id" TEXT PRIMARY KEY,
          "userId" TEXT NOT NULL
        );
        CREATE TABLE "AiJob" (
          "id" TEXT PRIMARY KEY,
          "tenderId" TEXT,
          "userId" TEXT NOT NULL,
          "jobType" TEXT NOT NULL,
          "status" TEXT NOT NULL
        );
      `);

      const sql = readFileSync(
        "prisma/migrations/20260712193000_ai_job_tender_owner_guard/migration.sql",
        "utf8",
      );

      // First apply — should succeed.
      await db.exec(sql);

      // Second apply — should also succeed (idempotent).
      await db.exec(sql);

      // Verify the trigger exists.
      const triggers = await db.query(`
        SELECT tgname FROM pg_trigger
        WHERE tgname = 'AiJob_tender_owner_guard'
      `);
      assert.equal(triggers.rows.length, 1, "trigger must exist after double-apply");

      // Verify the function exists.
      const funcs = await db.query(`
        SELECT proname FROM pg_proc WHERE proname = 'enforce_ai_job_tender_owner'
      `);
      assert.equal(funcs.rows.length, 1, "function must exist after double-apply");

      // Verify the trigger actually fires: insert a mismatched row.
      await db.query(`INSERT INTO "Tender" ("id", "userId") VALUES ('t-1', 'owner-1')`);
      let rejected = false;
      try {
        await db.query(`INSERT INTO "AiJob" ("id", "tenderId", "userId", "jobType", "status") VALUES ('j-1', 't-1', 'other-user', 'PROPOSAL_GENERATION', 'RUNNING')`);
      } catch {
        rejected = true;
      }
      assert.equal(rejected, true, "trigger must reject mismatched ownership");

      // Verify a valid insert succeeds.
      await db.query(`INSERT INTO "AiJob" ("id", "tenderId", "userId", "jobType", "status") VALUES ('j-2', 't-1', 'owner-1', 'PROPOSAL_GENERATION', 'RUNNING')`);

      // Verify a tenderless insert succeeds.
      await db.query(`INSERT INTO "AiJob" ("id", "tenderId", "userId", "jobType", "status") VALUES ('j-3', NULL, 'owner-1', 'PROFILE_FACT_EXTRACTION', 'QUEUED')`);
    } finally {
      await db.close();
    }
  });

  it("application-level ownership validation runs before AiJob creation in ai-proposal route", () => {
    // The route must verify tender ownership BEFORE calling prisma.aiJob.create
    // so a cross-tenant request gets a clean 404 instead of a 500 from the
    // database trigger.
    const source = readFileSync("app/api/tenders/[id]/ai-proposal/route.ts", "utf8");
    const ownershipCheckPos = source.indexOf("tenderOwnership");
    const jobCreatePos = source.indexOf("prisma.aiJob.create");
    assert.ok(ownershipCheckPos >= 0,
      "route must have a tenderOwnership ownership check");
    assert.ok(ownershipCheckPos < jobCreatePos,
      "ownership check must run BEFORE prisma.aiJob.create");
    assert.match(source, /where: \{ id: tenderId, userId: uid \}/,
      "ownership check must scope by both tenderId and userId");
    assert.match(source, /return NextResponse\.json\(\{ error: "Not found" \}, \{ status: 404 \}\)/,
      "route must return 404 when ownership check fails");
  });

  it("keeps Vercel Git deployment enabled (repo policy)", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8"));
    assert.equal(config.git?.deploymentEnabled, true);
  });
});

describe("AiJob tender ownership database acceptance", { skip: !RUN_DB_INTEGRATION }, () => {
  let ownerId = "";
  let otherUserId = "";
  let tenderId = "";
  let validJobId = "";
  let tenderlessJobId = "";

  before(async () => {
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const owner = await prisma.user.create({
      data: {
        email: `ai-job-owner-${stamp}@test.local`,
        name: "AI Job Owner",
        passwordHash: "unused",
        role: "PROPOSAL_MANAGER",
      },
    });
    const other = await prisma.user.create({
      data: {
        email: `ai-job-other-${stamp}@test.local`,
        name: "AI Job Other User",
        passwordHash: "unused",
        role: "PROPOSAL_MANAGER",
      },
    });
    ownerId = owner.id;
    otherUserId = other.id;

    const tender = await prisma.tender.create({
      data: { title: "AI Job Ownership Test", userId: ownerId },
    });
    tenderId = tender.id;
  });

  after(async () => {
    if (ownerId || otherUserId) {
      await prisma.aiJob.deleteMany({
        where: { userId: { in: [ownerId, otherUserId].filter(Boolean) } },
      });
    }
    if (tenderId) await prisma.tender.deleteMany({ where: { id: tenderId } });
    if (ownerId || otherUserId) {
      await prisma.user.deleteMany({
        where: { id: { in: [ownerId, otherUserId].filter(Boolean) } },
      });
    }
    await prisma.$disconnect();
  });

  it("rejects a cross-tenant insert and persists zero mismatched rows", async () => {
    await assert.rejects(
      () => prisma.aiJob.create({
        data: {
          tenderId,
          userId: otherUserId,
          jobType: "PROPOSAL_GENERATION",
          status: "RUNNING",
        },
      }),
      isOwnershipConstraintError,
    );

    const mismatched = await prisma.aiJob.count({
      where: { tenderId, userId: otherUserId },
    });
    assert.equal(mismatched, 0);
  });

  it("allows the tender owner to create a job", async () => {
    const job = await prisma.aiJob.create({
      data: {
        tenderId,
        userId: ownerId,
        jobType: "PROPOSAL_GENERATION",
        status: "RUNNING",
      },
    });
    validJobId = job.id;
    assert.equal(job.tenderId, tenderId);
    assert.equal(job.userId, ownerId);
  });

  it("rejects changing an existing job to a foreign user", async () => {
    assert.ok(validJobId, "valid owner job must exist");
    await assert.rejects(
      () => prisma.aiJob.update({
        where: { id: validJobId },
        data: { userId: otherUserId },
      }),
      isOwnershipConstraintError,
    );

    const unchanged = await prisma.aiJob.findUnique({ where: { id: validJobId } });
    assert.equal(unchanged?.userId, ownerId);
    assert.equal(unchanged?.tenderId, tenderId);
  });

  it("allows jobs without a tender", async () => {
    const job = await prisma.aiJob.create({
      data: {
        tenderId: null,
        userId: otherUserId,
        jobType: "PROFILE_FACT_EXTRACTION",
        status: "QUEUED",
      },
    });
    tenderlessJobId = job.id;
    assert.equal(job.tenderId, null);
    assert.equal(job.userId, otherUserId);
    assert.ok(tenderlessJobId);
  });
});
