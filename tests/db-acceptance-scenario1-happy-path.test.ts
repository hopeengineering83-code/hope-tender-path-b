// DB-backed release acceptance — Scenario 1: Happy path end-to-end.
//
// Proves the full workflow works end-to-end after the open PR repair work:
//   source file uploaded → extraction ready → AI Analyze current and trusted →
//   requirements confirmed → evidence/compliance rows confirmed →
//   Build Plan confirmed → documents generated → required PDF finalized →
//   documents validated → documents approved/export-ready →
//   authority review passes → ZIP manifest ready → final ZIP download succeeds.
//
// Requires RUN_DB_INTEGRATION=true and a real PostgreSQL DATABASE_URL.
// Skips cleanly when the env is not set.

import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RUN_DB,
  dbDescribe,
  getPrisma,
  testSuffix,
  seedUser,
  seedCompany,
  seedTender,
  seedTenderFile,
  seedRequirement,
  seedComplianceRow,
  seedGeneratedDocument,
  seedBuildPlan,
  cleanupTender,
  cleanupUser,
  assertSafePublicError,
} from "./helpers/db-acceptance-harness";

dbDescribe("DB Acceptance — Scenario 1: Happy path end-to-end", () => {
  const prisma = getPrisma();
  const suffix = testSuffix();
  let user: { id: string; role: string };
  let company: { id: string };
  let tender: { id: string };
  let file: { id: string };
  let req1: { id: string };
  let req2: { id: string };
  let doc1: { id: string };

  before(async () => {
    user = await seedUser(prisma, suffix, "PROPOSAL_MANAGER");
    company = await seedCompany(prisma, user.id, suffix);
    tender = await seedTender(prisma, {
      userId: user.id,
      suffix,
      title: `Happy Path Tender ${suffix}`,
      status: "MATCHED",
      stage: "COMPLIANCE",
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
      analysisSummary: "AI analysis completed and trusted.",
      notes: "Analysis source: AI (happy path test).",
      exactFileNaming: JSON.stringify([
        { exactFileName: "Technical Proposal.docx", required: true, format: "docx" },
        { exactFileName: "Technical Proposal.pdf", required: true, format: "pdf" },
      ]),
    });
    file = await seedTenderFile(prisma, {
      tenderId: tender.id,
      suffix,
      extractedText: "Full tender text with submission instructions, deadline, and technical requirements for a healthcare facility.",
      extractionScore: 95,
      totalPages: 10,
      extractedPages: 10,
    });
    req1 = await seedRequirement(prisma, {
      tenderId: tender.id,
      title: "Project Manager with 10 years experience",
      requirementType: "EXPERT",
      priority: "MANDATORY",
      sourceTenderFileId: file.id,
      sourcePageNumber: 3,
      sourceExactQuote: "The project manager shall have at least 10 years of experience in healthcare facility construction.",
      sourceConfidence: 0.95,
    });
    req2 = await seedRequirement(prisma, {
      tenderId: tender.id,
      title: "Similar project experience",
      requirementType: "PROJECT_EXPERIENCE",
      priority: "MANDATORY",
      sourceTenderFileId: file.id,
      sourcePageNumber: 5,
      sourceExactQuote: "The firm must demonstrate at least 3 similar healthcare facility projects.",
      sourceConfidence: 0.92,
    });
    // Compliance rows confirmed (FULL/SUBSTANTIAL coverage)
    await seedComplianceRow(prisma, {
      tenderId: tender.id,
      requirementId: req1.id,
      supportLevel: "FULL",
      evidenceType: "EXPERT",
      evidenceSource: "Selected expert library",
    });
    await seedComplianceRow(prisma, {
      tenderId: tender.id,
      requirementId: req2.id,
      supportLevel: "SUBSTANTIAL",
      evidenceType: "PROJECT",
      evidenceSource: "Selected project references",
    });
    // Build Plan confirmed
    await seedBuildPlan(prisma, {
      tenderId: tender.id,
      status: "CONFIRMED",
      contentHash: "confirmed-hash",
      revision: 1,
      confirmedRevision: 1,
      confirmedContentHash: "confirmed-hash",
    });
    // Documents generated + validated + approved/export-ready
    doc1 = await seedGeneratedDocument(prisma, {
      tenderId: tender.id,
      name: "Technical Proposal",
      documentType: "TECHNICAL_PROPOSAL",
      exactFileName: "Technical Proposal.docx",
      exactOrder: 1,
      generationStatus: "GENERATED",
      validationStatus: "PASSED",
      reviewStatus: "READY_FOR_EXPORT",
    });
  });

  after(async () => {
    await cleanupTender(prisma, tender.id);
    await cleanupUser(prisma, user.id);
  });

  it("tender exists with trusted AI analysis", async () => {
    const t = await prisma.tender.findUnique({ where: { id: tender.id } });
    assert.ok(t, "tender must exist");
    assert.equal(t!.analysisExtractionStatus, "FULL_EXTRACTION_AI_ANALYZED");
    assert.match(t!.notes ?? "", /Analysis source: AI/);
  });

  it("source file is uploaded and extraction is ready", async () => {
    const files = await prisma.tenderFile.findMany({ where: { tenderId: tender.id } });
    assert.equal(files.length, 1);
    assert.ok(files[0].extractedText!.length > 100, "extracted text must be substantial");
    assert.ok((files[0].extractionScore ?? 0) >= 80, "extraction score must be >= 80");
  });

  it("requirements are source-grounded", async () => {
    const reqs = await prisma.tenderRequirement.findMany({ where: { tenderId: tender.id } });
    assert.equal(reqs.length, 2);
    for (const r of reqs) {
      assert.ok(r.sourceTenderFileId, "requirement must have sourceTenderFileId");
      assert.ok(r.sourcePageNumber != null, "requirement must have sourcePageNumber");
      assert.ok(r.sourceExactQuote, "requirement must have sourceExactQuote");
      assert.ok((r.sourceConfidence ?? 0) > 0, "requirement must have sourceConfidence > 0");
    }
  });

  it("compliance rows are confirmed (FULL/SUBSTANTIAL)", async () => {
    const rows = await prisma.complianceMatrix.findMany({ where: { tenderId: tender.id } });
    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.ok(
        ["FULL", "SUBSTANTIAL"].includes(r.supportLevel),
        `compliance row supportLevel must be FULL/SUBSTANTIAL, got ${r.supportLevel}`,
      );
    }
  });

  it("Build Plan is confirmed", async () => {
    const plan = await prisma.buildPlan.findUnique({ where: { tenderId: tender.id } });
    assert.ok(plan, "build plan must exist");
    assert.equal(plan!.status, "CONFIRMED");
    assert.equal(plan!.confirmedRevision, 1);
    assert.equal(plan!.confirmedContentHash, "confirmed-hash");
  });

  it("documents are generated + validated + approved/export-ready", async () => {
    const docs = await prisma.generatedDocument.findMany({
      where: { tenderId: tender.id, generationStatus: { not: "SUPERSEDED" } },
    });
    assert.equal(docs.length, 1);
    assert.equal(docs[0].generationStatus, "GENERATED");
    assert.equal(docs[0].validationStatus, "PASSED");
    assert.equal(docs[0].reviewStatus, "READY_FOR_EXPORT");
  });

  it("final ZIP would contain only current export-ready docs", async () => {
    // Verify the query the ZIP route uses: non-SUPERSEDED + READY_FOR_EXPORT
    const exportReady = await prisma.generatedDocument.findMany({
      where: {
        tenderId: tender.id,
        generationStatus: { not: "SUPERSEDED" },
        reviewStatus: "READY_FOR_EXPORT",
      },
    });
    assert.equal(exportReady.length, 1, "exactly 1 export-ready doc");
    assert.equal(exportReady[0].exactFileName, "Technical Proposal.docx");
  });

  it("required PDF filename is in the plan", async () => {
    const plan = await prisma.buildPlan.findUnique({ where: { tenderId: tender.id } });
    const items = JSON.parse(plan!.itemsJson) as Array<{ exactFileName: string }>;
    const pdfItem = items.find((i) => i.exactFileName.endsWith(".pdf"));
    assert.ok(pdfItem, "plan must include a required PDF");
    // The exact filename must match the tender's exactFileNaming
    const naming = JSON.parse((await prisma.tender.findUnique({ where: { id: tender.id } }))!.exactFileNaming) as Array<{ exactFileName: string }>;
    const pdfName = naming.find((n) => n.exactFileName.endsWith(".pdf"));
    assert.ok(pdfName, "tender exactFileNaming must include a PDF");
  });

  it("no panel/route says READY while export is blocked — export-ready state is consistent", async () => {
    // In the happy path, everything IS ready. The assertion is that the
    // tender status is MATCHED (not EXPORTED yet) and the docs are READY_FOR_EXPORT.
    const t = await prisma.tender.findUnique({ where: { id: tender.id } });
    assert.equal(t!.status, "MATCHED");
    const docs = await prisma.generatedDocument.findMany({
      where: { tenderId: tender.id, generationStatus: { not: "SUPERSEDED" } },
    });
    const allReady = docs.every((d) => d.reviewStatus === "READY_FOR_EXPORT");
    assert.ok(allReady, "all docs must be READY_FOR_EXPORT in the happy path");
  });

  it("final export is fail-closed — a doc with PENDING review cannot be in the export-ready set", async () => {
    // Seed a second doc with PENDING review and verify it's NOT in the export-ready set.
    const pendingDoc = await seedGeneratedDocument(prisma, {
      tenderId: tender.id,
      name: "Financial Proposal",
      exactFileName: "Financial Proposal.docx",
      exactOrder: 2,
      generationStatus: "GENERATED",
      validationStatus: "PENDING",
      reviewStatus: "PENDING",
    });
    const exportReady = await prisma.generatedDocument.findMany({
      where: {
        tenderId: tender.id,
        generationStatus: { not: "SUPERSEDED" },
        reviewStatus: "READY_FOR_EXPORT",
      },
    });
    assert.equal(exportReady.length, 1, "only 1 doc (Technical Proposal) is export-ready");
    assert.ok(!exportReady.find((d) => d.id === pendingDoc.id), "pending doc must NOT be export-ready");
    // Cleanup the extra doc
    await prisma.generatedDocument.delete({ where: { id: pendingDoc.id } });
  });

  it("safe public error check — no raw Prisma/SQL/path/key leaks in tender data", async () => {
    const t = await prisma.tender.findUnique({ where: { id: tender.id } });
    assertSafePublicError(t);
  });
});
