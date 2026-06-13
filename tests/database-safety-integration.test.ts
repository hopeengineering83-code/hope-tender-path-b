import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { prisma, prismaReady } from "../lib/prisma";
import { checkTenderLevelExportBlockers } from "../lib/engine/export-readiness";

const dbDescribe = process.env.RUN_DB_INTEGRATION === "true" ? describe : describe.skip;

const SOURCE_QUOTE = "The financial proposal must be enclosed in a separate sealed envelope.";

let userId = "";
let tenderId = "";
let fileId = "";

dbDescribe("database-backed analysis and export safeguards", () => {
  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await prisma.user.create({
      data: {
        email: `db-integration-${nonce}@example.test`,
        passwordHash: "integration-test-only",
        role: "ADMIN",
        name: "DB Integration Test",
      },
    });
    userId = user.id;

    const tender = await prisma.tender.create({
      data: {
        userId,
        title: "Database safety integration tender",
        clientName: "Example Procuring Authority",
        reference: `INT-${nonce}`,
        country: "Ethiopia",
        status: "DRAFT",
        stage: "TENDER_INTAKE",
      },
    });
    tenderId = tender.id;

    const file = await prisma.tenderFile.create({
      data: {
        tenderId,
        fileName: "stored-instructions.pdf",
        originalFileName: "Instructions.pdf",
        mimeType: "application/pdf",
        size: 1024,
        extractedText: `Page 12. ${SOURCE_QUOTE}`,
        totalPages: 12,
        extractedPages: 12,
        failedPages: 0,
        extractionScore: 100,
        extractionMethod: "text",
      },
    });
    fileId = file.id;
  });

  after(async () => {
    if (!userId) return;
    // A running job also makes cleanup safe if PostgreSQL evaluates the child
    // cascade before the parent Tender row is no longer visible to the guard.
    if (tenderId) {
      await prisma.aiJob.create({
        data: { tenderId, userId, jobType: "AI_ANALYZE", status: "RUNNING", startedAt: new Date() },
      }).catch(() => undefined);
    }
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("links a requirement to the unique TenderFile containing its exact quote", async () => {
    const requirement = await prisma.tenderRequirement.create({
      data: {
        tenderId,
        title: "Separate financial envelope",
        description: "Financial proposal must be submitted separately.",
        requirementType: "FINANCIAL",
        priority: "MANDATORY",
        sourcePageNumber: 12,
        sourceExactQuote: SOURCE_QUOTE,
        sourceConfidence: 0.9,
      },
    });

    const stored = await prisma.tenderRequirement.findUniqueOrThrow({ where: { id: requirement.id } });
    assert.equal(stored.sourceTenderFileId, fileId);
    assert.equal(stored.sourceExtractionMethod, "text");
    assert.ok(stored.sourceConfidence >= 0.95);
  });

  it("refuses to delete the final canonical requirement set without a staged run", async () => {
    await assert.rejects(
      prisma.tenderRequirement.deleteMany({ where: { tenderId } }),
      /Refusing to delete the final canonical tender requirement set/i,
    );

    const remaining = await prisma.tenderRequirement.count({ where: { tenderId } });
    assert.ok(remaining > 0, "the canonical requirement set must survive a rejected delete");

    await prisma.aiJob.create({
      data: { tenderId, userId, jobType: "AI_ANALYZE", status: "RUNNING", startedAt: new Date() },
    });
    const deleted = await prisma.tenderRequirement.deleteMany({ where: { tenderId } });
    assert.ok(deleted.count > 0);

    await prisma.tenderRequirement.create({
      data: {
        tenderId,
        title: "Separate financial envelope",
        description: "Financial proposal must be submitted separately.",
        requirementType: "FINANCIAL",
        priority: "MANDATORY",
        sourcePageNumber: 12,
        sourceExactQuote: SOURCE_QUOTE,
      },
    });
  });

  it("persists submission-plan provenance and confirmation as structured state", async () => {
    const document = await prisma.generatedDocument.create({
      data: {
        tenderId,
        name: "Technical Proposal",
        documentType: "TECHNICAL_PROPOSAL",
        exactFileName: "Technical-Proposal.docx",
        exactOrder: 1,
        generationStatus: "PLANNED",
        reviewStatus: "PENDING",
        contentSummary: "DERIVED_DRAFT_UNCONFIRMED: compiled from requirement keywords",
      },
    });

    type PlanState = {
      provenance: string;
      confirmationStatus: string;
      derivedDocumentCount: number;
      activeDocumentCount: number;
    };
    const [unconfirmed] = await prisma.$queryRaw<PlanState[]>`
      SELECT "provenance", "confirmationStatus", "derivedDocumentCount", "activeDocumentCount"
      FROM "SubmissionPlanState"
      WHERE "tenderId" = ${tenderId}
    `;
    assert.equal(unconfirmed.provenance, "DERIVED_FROM_REQUIREMENTS");
    assert.equal(unconfirmed.confirmationStatus, "UNCONFIRMED");
    assert.equal(unconfirmed.derivedDocumentCount, 1);

    await prisma.generatedDocument.update({ where: { id: document.id }, data: { reviewStatus: "CONFIRMED" } });
    const [confirmed] = await prisma.$queryRaw<PlanState[]>`
      SELECT "provenance", "confirmationStatus", "derivedDocumentCount", "activeDocumentCount"
      FROM "SubmissionPlanState"
      WHERE "tenderId" = ${tenderId}
    `;
    assert.equal(confirmed.confirmationStatus, "CONFIRMED");
    assert.ok(confirmed.activeDocumentCount >= 1);
  });

  it("executes tender-level export blockers against the live database", async () => {
    const result = await checkTenderLevelExportBlockers(tenderId, []);
    const categories = new Set(result.blockers.map((blocker) => blocker.category));
    assert.ok(categories.has("NO_ACTIVE_GENERATED_DOCUMENTS"));
    assert.ok(categories.has("SUBMISSION_METHOD_MISSING"));
    assert.ok(categories.has("DEADLINE_MISSING"));
  });
});
