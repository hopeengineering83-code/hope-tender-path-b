import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { PrismaClient } from "@prisma/client";
import { enqueueEngineJobForCurrentSources } from "../lib/engine/enqueue-engine-job";

const RUN_DB_INTEGRATION = process.env.RUN_DB_INTEGRATION === "true";
const prisma = new PrismaClient();

describe("canonical Engine enqueue authority", { skip: !RUN_DB_INTEGRATION }, () => {
  let userId = "";
  let companyId = "";
  let tenderId = "";
  let tenderFileId = "";
  let requirementId = "";

  before(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await prisma.user.create({
      data: {
        email: `engine-enqueue-${suffix}@test.local`,
        name: "Engine Enqueue Test User",
        passwordHash: "unused",
        role: "PROPOSAL_MANAGER",
      },
    });
    userId = user.id;

    const company = await prisma.company.create({
      data: {
        name: "Engine Enqueue Test Company",
        userId,
        documents: {
          create: [{
            originalFileName: "company-profile.pdf",
            fileName: "company-profile.pdf",
            mimeType: "application/pdf",
            size: 512,
            category: "COMPANY_PROFILE",
            extractedText: "Source verified company profile evidence for the Engine enqueue integration test.",
            contentSha256: "b".repeat(64),
            contentByteLength: 512,
            integrityStatus: "VERIFIED",
            aiExtractionStatus: "COMPLETED",
          }],
        },
      },
    });
    companyId = company.id;

    const tender = await prisma.tender.create({
      data: {
        title: "Engine Enqueue Integration Tender",
        userId,
        analysisExtractionStatus: "AI_COMPLETE",
        files: {
          create: [{
            originalFileName: "tender.pdf",
            fileName: "tender.pdf",
            mimeType: "application/pdf",
            size: 1024,
            extractedText: "Tender source text with a mandatory requirement and enough content for deterministic source binding.",
            contentSha256: "a".repeat(64),
            contentByteLength: 1024,
            integrityStatus: "VERIFIED",
            extractionMethod: "text",
            extractionScore: 100,
          }],
        },
        requirements: {
          create: [{
            title: "Provide company profile",
            description: "Submit a current company profile.",
            requirementType: "DOCUMENT",
            priority: "MANDATORY",
            sourcePageNumber: 1,
            sourceExactQuote: "Submit a current company profile.",
            sourceExtractionMethod: "text",
            sourceConfidence: 1,
          }],
        },
      },
      include: { requirements: { select: { id: true } } },
    });
    tenderId = tender.id;
    tenderFileId = (await prisma.tenderFile.findFirstOrThrow({
      where: { tenderId },
      select: { id: true },
    })).id;
    requirementId = tender.requirements[0]!.id;
  });

  after(async () => {
    if (userId) {
      await prisma.aiJob.deleteMany({ where: { userId } });
      await prisma.tender.deleteMany({ where: { userId } });
      await prisma.company.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma.$disconnect();
  });

  it("converges eight concurrent requests on one persisted active job", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => enqueueEngineJobForCurrentSources(prisma, {
        userId,
        tenderId,
        companyId,
        purpose: "DB_INTEGRATION_TEST",
        manualRequested: true,
      })),
    );

    assert.ok(results.every(Boolean), "every request must resolve a current source revision");
    const nonNull = results.filter((result): result is NonNullable<typeof result> => Boolean(result));
    const jobIds = new Set(nonNull.map((result) => result.job.id));
    const revisions = new Set(nonNull.map((result) => result.revision.sourceRevision));
    const keys = new Set(nonNull.map((result) => result.idempotencyKey));

    assert.equal(jobIds.size, 1, "all duplicate requests must return the same persisted job");
    assert.equal(revisions.size, 1, "all duplicate requests must bind the same source revision");
    assert.equal(keys.size, 1, "all duplicate requests must use the same idempotency key");

    const rows = await prisma.aiJob.findMany({
      where: {
        userId,
        tenderId,
        jobType: "ENGINE_RUN",
        status: { in: ["QUEUED", "RUNNING", "PARTIAL_SUCCESS"] },
      },
    });
    assert.equal(rows.length, 1, "only one authoritative active Engine row may exist for unchanged sources");
    assert.equal(rows[0]!.id, [...jobIds][0]);
    assert.equal(rows[0]!.analysisInputHash, [...revisions][0]);
  });

  it("does not supersede its immutable input revision after the Engine replaces derived output", async () => {
    const before = await prisma.aiJob.findFirstOrThrow({
      where: { userId, tenderId, jobType: "ENGINE_RUN", status: "QUEUED" },
      orderBy: { createdAt: "desc" },
    });

    // Mirror the source-revision-relevant shape of runTenderEngine's own
    // transaction: it updates Tender workflow fields and replaces derived
    // TenderRequirement rows before the worker performs its post-run stale
    // source checkpoint. None of these Engine-owned writes may invalidate the
    // immutable tender-file + Company Vault input revision.
    await prisma.tender.update({
      where: { id: tenderId },
      data: {
        status: "MATCHED",
        stage: "MATCHING",
        readinessScore: 73,
        notes: "Engine-owned derived workflow output",
      },
    });
    await prisma.tenderRequirement.delete({ where: { id: requirementId } });
    const replacement = await prisma.tenderRequirement.create({
      data: {
        tenderId,
        title: "Provide company profile and registration evidence",
        description: "Submit the current company profile with legal registration evidence.",
        requirementType: "DOCUMENT",
        priority: "MANDATORY",
        sourcePageNumber: 1,
        sourceExactQuote: "Submit the current company profile with legal registration evidence.",
        sourceExtractionMethod: "text",
        sourceConfidence: 1,
      },
      select: { id: true },
    });
    requirementId = replacement.id;

    const next = await enqueueEngineJobForCurrentSources(prisma, {
      userId,
      tenderId,
      companyId,
      purpose: "DB_INTEGRATION_TEST_AFTER_REQUIREMENT_CHANGE",
        manualRequested: true,
    });
    assert.ok(next);
    assert.equal(next.job.id, before.id);
    assert.equal(next.revision.sourceRevision, before.analysisInputHash);

    const stale = await prisma.aiJob.findUniqueOrThrow({ where: { id: before.id } });
    assert.equal(stale.status, "QUEUED");

    const activeRows = await prisma.aiJob.findMany({
      where: {
        userId,
        tenderId,
        jobType: "ENGINE_RUN",
        status: { in: ["QUEUED", "RUNNING", "PARTIAL_SUCCESS"] },
      },
    });
    assert.equal(activeRows.length, 1);
    assert.equal(activeRows[0]!.id, next.job.id);
  });

  it("supersedes an active job when actual tender source bytes change", async () => {
    const before = await prisma.aiJob.findFirstOrThrow({
      where: { userId, tenderId, jobType: "ENGINE_RUN", status: "QUEUED" },
      orderBy: { createdAt: "desc" },
    });

    await prisma.tenderFile.update({
      where: { id: tenderFileId },
      data: {
        contentSha256: "c".repeat(64),
        contentByteLength: 2048,
      },
    });

    const next = await enqueueEngineJobForCurrentSources(prisma, {
      userId,
      tenderId,
      companyId,
      purpose: "DB_INTEGRATION_TEST_AFTER_SOURCE_CHANGE",
        manualRequested: true,
    });
    assert.ok(next);
    assert.notEqual(next.job.id, before.id);
    assert.notEqual(next.revision.sourceRevision, before.analysisInputHash);

    const stale = await prisma.aiJob.findUniqueOrThrow({ where: { id: before.id } });
    assert.equal(stale.status, "CANCELED");
    assert.match(stale.errorMessage ?? "", /Superseded by a newer Engine source revision/);
  });

  it("returns no revision for a different tenant identity", async () => {
    const result = await enqueueEngineJobForCurrentSources(prisma, {
      userId: "cross-tenant-user-id",
      tenderId,
      companyId,
      purpose: "CROSS_TENANT_TEST",
    });
    assert.equal(result, null);
  });
});
