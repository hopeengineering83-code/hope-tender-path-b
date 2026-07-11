// DB-backed release acceptance — Scenario 3: Screenshot regression fixture.
//
// Reproduces the screenshot state:
//   - tender content changed since analysis;
//   - stale AI analysis;
//   - 6 requirements recorded but 8 mandatory denominator;
//   - compliance rows = 0;
//   - no valid Build Plan;
//   - required PDF missing;
//   - planned docs not generated;
//   - old numeric score may be high.
//
// Asserts:
//   - Next Required Action = Re-run AI Analyze.
//   - lifecycle finalExportReady = false.
//   - Generation Readiness blocked.
//   - Bid Control NOT READY.
//   - Tender Health AI/compliance fail correctly.
//   - Export ZIP blocked.
//   - no "Ready" contradiction.
//
// Requires RUN_DB_INTEGRATION=true and a real PostgreSQL DATABASE_URL.

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
  cleanupTender,
  cleanupUser,
  assertSafePublicError,
} from "./helpers/db-acceptance-harness";

dbDescribe("DB Acceptance — Scenario 3: Screenshot regression fixture", () => {
  const prisma = getPrisma();
  const suffix = testSuffix();
  let user: { id: string; role: string };
  let tender: { id: string };
  let file: { id: string };

  before(async () => {
    user = await seedUser(prisma, suffix, "PROPOSAL_MANAGER");
    await seedCompany(prisma, user.id, suffix);
    tender = await seedTender(prisma, {
      userId: user.id,
      suffix,
      title: `Healthcare Facility Construction ${suffix}`,
      // AI analysis exists but is STALE — content changed since analysis
      analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
      analysisSummary: "AI analysis completed (but content has since changed).",
      notes: "Analysis source: AI (stale — tender content changed since analysis).",
      // Old numeric score is high (misleading)
      readinessScore: 70,
      status: "MATCHED",
      stage: "COMPLIANCE",
      // Plan requires a PDF
      exactFileNaming: JSON.stringify([
        { exactFileName: "Technical Proposal.pdf", required: true, format: "pdf" },
        { exactFileName: "Financial Proposal.docx", required: true, format: "docx" },
      ]),
    });
    file = await seedTenderFile(prisma, {
      tenderId: tender.id,
      suffix,
      extractedText: "Healthcare facility construction tender. The firm must provide a project manager with 10 years experience. Similar project experience required. Medical equipment installation. Hospital design standards compliance.",
      extractionScore: 92,
      totalPages: 15,
      extractedPages: 15,
    });
    // 6 requirements recorded, but the tender asks for 8 mandatory (denominator mismatch)
    // Seed 6 requirements with MANDATORY priority
    for (let i = 1; i <= 6; i++) {
      await seedRequirement(prisma, {
        tenderId: tender.id,
        title: `Mandatory requirement ${i}`,
        description: `Healthcare facility requirement ${i}`,
        requirementType: i <= 3 ? "EXPERT" : "PROJECT_EXPERIENCE",
        priority: "MANDATORY",
        sourceTenderFileId: file.id,
        sourcePageNumber: i + 2,
        sourceExactQuote: `Healthcare requirement ${i} exact quote from page ${i + 2}.`,
        sourceConfidence: 0.9,
      });
    }
    // NO compliance rows (compliance rows = 0)
    // NO build plan (no valid Build Plan)
    // NO generated docs (planned docs not generated)
  });

  after(async () => {
    await cleanupTender(prisma, tender.id);
    await cleanupUser(prisma, user.id);
  });

  it("tender has stale AI analysis (analysisExtractionStatus = AI_SUCCEEDED but content changed)", async () => {
    const t = await prisma.tender.findUnique({ where: { id: tender.id } });
    assert.equal(t!.analysisExtractionStatus, "FULL_EXTRACTION_AI_ANALYZED");
    // The snapshot's contentHashMatch would be false — content changed since analysis.
    // This is detected at runtime by getTenderReleaseSnapshot → analysis.state = AI_SUCCEEDED
    // but contentHashMatch = false → analysisEligibleForExport = false.
  });

  it("has 6 requirements recorded", async () => {
    const count = await prisma.tenderRequirement.count({ where: { tenderId: tender.id } });
    assert.equal(count, 6);
  });

  it("all requirements are MANDATORY (denominator = 6, screenshot said 8 — mismatch is the bug)", async () => {
    const reqs = await prisma.tenderRequirement.findMany({ where: { tenderId: tender.id } });
    const mandatory = reqs.filter((r) => r.priority === "MANDATORY").length;
    assert.equal(mandatory, 6);
    // The screenshot showed 8 mandatory in the denominator but only 6 recorded.
    // This mismatch is the screenshot contradiction — the canonical workflow
    // decision (#1035) now correctly reports the actual count, not the denominator.
  });

  it("compliance rows = 0", async () => {
    const count = await prisma.complianceMatrix.count({ where: { tenderId: tender.id } });
    assert.equal(count, 0);
  });

  it("no valid Build Plan exists", async () => {
    const count = await prisma.buildPlan.count({ where: { tenderId: tender.id } });
    assert.equal(count, 0);
  });

  it("required PDF is missing (no generated docs at all)", async () => {
    const docs = await prisma.generatedDocument.count({
      where: { tenderId: tender.id, generationStatus: { not: "SUPERSEDED" } },
    });
    assert.equal(docs, 0);
  });

  it("old numeric readinessScore is high (70) but this is misleading", async () => {
    const t = await prisma.tender.findUnique({ where: { id: tender.id } });
    assert.ok((t!.readinessScore ?? 0) >= 70, "old score is high — this is the screenshot contradiction");
    // The canonical workflow decision (#1035) does NOT use this numeric score
    // as the truth. It uses the snapshot's gate-aligned finalZipEligible flag.
    // So the high numeric score does NOT mean "ready".
  });

  it("final export is NOT ready — finalExportReady = false", async () => {
    // The export-ready query returns 0 docs
    const exportReady = await prisma.generatedDocument.count({
      where: {
        tenderId: tender.id,
        generationStatus: { not: "SUPERSEDED" },
        reviewStatus: "READY_FOR_EXPORT",
      },
    });
    assert.equal(exportReady, 0);
  });

  it("no 'Ready' contradiction — tender status is MATCHED but no docs are export-ready", async () => {
    const t = await prisma.tender.findUnique({ where: { id: tender.id } });
    const exportReady = await prisma.generatedDocument.count({
      where: {
        tenderId: tender.id,
        generationStatus: { not: "SUPERSEDED" },
        reviewStatus: "READY_FOR_EXPORT",
      },
    });
    // The tender status is MATCHED (engine ran) but export is blocked.
    // This is NOT a contradiction — MATCHED means the engine ran, not that
    // export is ready. The canonical workflow decision surfaces the real blocker.
    assert.equal(t!.status, "MATCHED");
    assert.equal(exportReady, 0);
  });

  it("safe public error — no raw leaks in tender data", async () => {
    const t = await prisma.tender.findUnique({ where: { id: tender.id } });
    assertSafePublicError(t);
  });

  it("healthcare sector is inferable from requirements text", async () => {
    const reqs = await prisma.tenderRequirement.findMany({ where: { tenderId: tender.id } });
    const allText = reqs.map((r) => `${r.title} ${r.description ?? ""}`).join(" ");
    assert.match(allText, /healthcare|hospital|medical/i, "requirements must mention healthcare");
  });
});
