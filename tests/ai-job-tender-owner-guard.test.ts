import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

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

  it("keeps Vercel Git deployment disabled", () => {
    const config = JSON.parse(readFileSync("vercel.json", "utf8"));
    assert.equal(config.git?.deploymentEnabled, false);
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
