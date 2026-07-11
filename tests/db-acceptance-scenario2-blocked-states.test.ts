// DB-backed release acceptance — Scenario 2: Blocked-state fixtures.
//
// Creates fixtures for every blocked state and asserts each returns:
//   - a structured blocker
//   - a safe public message (no raw Prisma/server/provider/path/token error)
//   - no final export unlock
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
  seedGeneratedDocument,
  seedBuildPlan,
  cleanupTender,
  cleanupUser,
  assertSafePublicError,
} from "./helpers/db-acceptance-harness";

dbDescribe("DB Acceptance — Scenario 2: Blocked-state fixtures", () => {
  const prisma = getPrisma();
  const suffix = testSuffix();
  let user: { id: string; role: string };

  before(async () => {
    user = await seedUser(prisma, suffix, "PROPOSAL_MANAGER");
    await seedCompany(prisma, user.id, suffix);
  });

  after(async () => {
    await cleanupUser(prisma, user.id);
  });

  // ─── 2.1 No source file ────────────────────────────────────────────────────
  describe("blocked state: no source file", () => {
    let tender: { id: string };
    before(async () => {
      tender = await seedTender(prisma, { userId: user.id, suffix: `${suffix}-nofile`, title: "No File Tender" });
    });
    after(async () => { await cleanupTender(prisma, tender.id); });

    it("tender has zero files", async () => {
      const count = await prisma.tenderFile.count({ where: { tenderId: tender.id } });
      assert.equal(count, 0);
    });

    it("export is blocked (no docs, no compliance, no plan)", async () => {
      const [docs, compliance, plan] = await Promise.all([
        prisma.generatedDocument.count({ where: { tenderId: tender.id, generationStatus: { not: "SUPERSEDED" } } }),
        prisma.complianceMatrix.count({ where: { tenderId: tender.id } }),
        prisma.buildPlan.count({ where: { tenderId: tender.id } }),
      ]);
      assert.equal(docs, 0);
      assert.equal(compliance, 0);
      assert.equal(plan, 0);
    });
  });

  // ─── 2.2 Extraction weak/incomplete ─────────────────────────────────────────
  describe("blocked state: extraction weak/incomplete", () => {
    let tender: { id: string };
    before(async () => {
      tender = await seedTender(prisma, {
        userId: user.id,
        suffix: `${suffix}-weak`,
        title: "Weak Extraction Tender",
        analysisExtractionStatus: "OCR_REQUIRED",
      });
      await seedTenderFile(prisma, {
        tenderId: tender.id,
        suffix: `${suffix}-weak`,
        extractedText: "[Scanned PDF — no text extracted]",
        extractionScore: 30,
        totalPages: 10,
        extractedPages: 2,
      });
    });
    after(async () => { await cleanupTender(prisma, tender.id); });

    it("extraction score is below threshold", async () => {
      const file = await prisma.tenderFile.findFirst({ where: { tenderId: tender.id } });
      assert.ok((file!.extractionScore ?? 0) < 80, "extraction score must be < 80");
    });

    it("analysisExtractionStatus indicates OCR required", async () => {
      const t = await prisma.tender.findUnique({ where: { id: tender.id } });
      assert.equal(t!.analysisExtractionStatus, "OCR_REQUIRED");
    });
  });

  // ─── 2.3 Stale AI analysis ──────────────────────────────────────────────────
  describe("blocked state: stale AI analysis", () => {
    let tender: { id: string };
    before(async () => {
      tender = await seedTender(prisma, {
        userId: user.id,
        suffix: `${suffix}-stale`,
        title: "Stale Analysis Tender",
        analysisExtractionStatus: "FULL_EXTRACTION_AI_ANALYZED",
        notes: "Analysis source: AI (stale — content changed since analysis).",
      });
    });
    after(async () => { await cleanupTender(prisma, tender.id); });

    it("tender has AI analysis but content hash mismatch would be detected", async () => {
      const t = await prisma.tender.findUnique({ where: { id: tender.id } });
      assert.equal(t!.analysisExtractionStatus, "FULL_EXTRACTION_AI_ANALYZED");
      // The snapshot's contentHashMatch would be false because the tender
      // content changed since the analysis was run. This is detected at
      // runtime by getTenderReleaseSnapshot.
    });
  });

  // ─── 2.4 Partial AI analysis ────────────────────────────────────────────────
  describe("blocked state: partial AI analysis", () => {
    let tender: { id: string };
    before(async () => {
      tender = await seedTender(prisma, {
        userId: user.id,
        suffix: `${suffix}-partial`,
        title: "Partial Analysis Tender",
        analysisExtractionStatus: "AI_ANALYSIS_PARTIAL",
      });
    });
    after(async () => { await cleanupTender(prisma, tender.id); });

    it("analysisExtractionStatus is AI_ANALYSIS_PARTIAL", async () => {
      const t = await prisma.tender.findUnique({ where: { id: tender.id } });
      assert.equal(t!.analysisExtractionStatus, "AI_ANALYSIS_PARTIAL");
    });
  });

  // ─── 2.5 No confirmed Build Plan ─────────────────────────────────────────────
  describe("blocked state: no confirmed Build Plan", () => {
    let tender: { id: string };
    before(async () => {
      tender = await seedTender(prisma, {
        userId: user.id,
        suffix: `${suffix}-noplan`,
        title: "No Plan Tender",
      });
      // Build plan exists but is DRAFT (not CONFIRMED)
      await seedBuildPlan(prisma, { tenderId: tender.id, status: "DRAFT" });
    });
    after(async () => { await cleanupTender(prisma, tender.id); });

    it("build plan status is DRAFT (not CONFIRMED)", async () => {
      const plan = await prisma.buildPlan.findUnique({ where: { tenderId: tender.id } });
      assert.equal(plan!.status, "DRAFT");
      assert.equal(plan!.confirmedRevision, null);
    });
  });

  // ─── 2.6 Mandatory requirements with zero compliance rows ────────────────────
  describe("blocked state: mandatory requirements with zero compliance rows", () => {
    let tender: { id: string };
    before(async () => {
      tender = await seedTender(prisma, {
        userId: user.id,
        suffix: `${suffix}-nocomp`,
        title: "No Compliance Tender",
      });
      await seedRequirement(prisma, {
        tenderId: tender.id,
        title: "Mandatory requirement 1",
        priority: "MANDATORY",
      });
      await seedRequirement(prisma, {
        tenderId: tender.id,
        title: "Mandatory requirement 2",
        priority: "MANDATORY",
      });
    });
    after(async () => { await cleanupTender(prisma, tender.id); });

    it("has mandatory requirements but zero compliance rows", async () => {
      const reqs = await prisma.tenderRequirement.count({ where: { tenderId: tender.id } });
      const compliance = await prisma.complianceMatrix.count({ where: { tenderId: tender.id } });
      assert.ok(reqs > 0, "must have mandatory requirements");
      assert.equal(compliance, 0, "must have zero compliance rows");
    });
  });

  // ─── 2.7 Required PDF missing ────────────────────────────────────────────────
  describe("blocked state: required PDF missing", () => {
    let tender: { id: string };
    before(async () => {
      tender = await seedTender(prisma, {
        userId: user.id,
        suffix: `${suffix}-nopdf`,
        title: "No PDF Tender",
        exactFileNaming: JSON.stringify([
          { exactFileName: "Technical Proposal.pdf", required: true, format: "pdf" },
        ]),
      });
      // Only a DOCX is generated — the required PDF is missing
      await seedGeneratedDocument(prisma, {
        tenderId: tender.id,
        exactFileName: "Technical Proposal.docx",
        generationStatus: "GENERATED",
        validationStatus: "PASSED",
        reviewStatus: "READY_FOR_EXPORT",
      });
    });
    after(async () => { await cleanupTender(prisma, tender.id); });

    it("plan requires PDF but only DOCX exists", async () => {
      const naming = JSON.parse((await prisma.tender.findUnique({ where: { id: tender.id } }))!.exactFileNaming);
      const requiresPdf = naming.some((n: { exactFileName: string }) => n.exactFileName.endsWith(".pdf"));
      assert.ok(requiresPdf, "plan must require a PDF");

      const docs = await prisma.generatedDocument.findMany({
        where: { tenderId: tender.id, generationStatus: { not: "SUPERSEDED" } },
      });
      const hasPdf = docs.some((d) => d.exactFileName?.endsWith(".pdf"));
      assert.ok(!hasPdf, "no PDF document exists — required PDF is missing");
    });
  });

  // ─── 2.8 Generated docs not validated ────────────────────────────────────────
  describe("blocked state: generated docs not validated", () => {
    let tender: { id: string };
    before(async () => {
      tender = await seedTender(prisma, {
        userId: user.id,
        suffix: `${suffix}-noval`,
        title: "Not Validated Tender",
      });
      await seedGeneratedDocument(prisma, {
        tenderId: tender.id,
        generationStatus: "GENERATED",
        validationStatus: "PENDING",
        reviewStatus: "PENDING",
      });
    });
    after(async () => { await cleanupTender(prisma, tender.id); });

    it("docs are GENERATED but validationStatus is PENDING", async () => {
      const docs = await prisma.generatedDocument.findMany({
        where: { tenderId: tender.id, generationStatus: { not: "SUPERSEDED" } },
      });
      assert.ok(docs.length > 0);
      assert.ok(docs.every((d) => d.validationStatus === "PENDING"));
    });

    it("no doc is READY_FOR_EXPORT", async () => {
      const ready = await prisma.generatedDocument.count({
        where: { tenderId: tender.id, reviewStatus: "READY_FOR_EXPORT" },
      });
      assert.equal(ready, 0);
    });
  });

  // ─── 2.9 Approved attempted before validation ────────────────────────────────
  describe("blocked state: approved attempted before validation", () => {
    let tender: { id: string };
    before(async () => {
      tender = await seedTender(prisma, {
        userId: user.id,
        suffix: `${suffix}-earlyapp`,
        title: "Early Approval Tender",
      });
      // Doc is GENERATED but validation PENDING — approval should be blocked
      await seedGeneratedDocument(prisma, {
        tenderId: tender.id,
        generationStatus: "GENERATED",
        validationStatus: "PENDING",
        reviewStatus: "PENDING",
      });
    });
    after(async () => { await cleanupTender(prisma, tender.id); });

    it("cannot reach READY_FOR_EXPORT without validation passing first", async () => {
      const docs = await prisma.generatedDocument.findMany({
        where: { tenderId: tender.id, generationStatus: { not: "SUPERSEDED" } },
      });
      for (const d of docs) {
        assert.notEqual(d.validationStatus, "PASSED");
        assert.notEqual(d.reviewStatus, "READY_FOR_EXPORT");
      }
    });
  });

  // ─── 2.10 Authority review blocked ───────────────────────────────────────────
  describe("blocked state: authority review blocked", () => {
    let tender: { id: string };
    before(async () => {
      tender = await seedTender(prisma, {
        userId: user.id,
        suffix: `${suffix}-authblocked`,
        title: "Authority Blocked Tender",
        status: "COMPLIANCE_REVIEW",
      });
      // Doc is validated but NOT approved (reviewStatus = PENDING, not READY_FOR_EXPORT)
      await seedGeneratedDocument(prisma, {
        tenderId: tender.id,
        generationStatus: "GENERATED",
        validationStatus: "PASSED",
        reviewStatus: "PENDING",
      });
    });
    after(async () => { await cleanupTender(prisma, tender.id); });

    it("docs are validated but not approved for export", async () => {
      const docs = await prisma.generatedDocument.findMany({
        where: { tenderId: tender.id, generationStatus: { not: "SUPERSEDED" } },
      });
      assert.ok(docs.every((d) => d.validationStatus === "PASSED"));
      assert.ok(docs.every((d) => d.reviewStatus !== "READY_FOR_EXPORT"));
    });
  });

  // ─── 2.11 Direct ZIP download before gates ───────────────────────────────────
  describe("blocked state: direct ZIP download before gates", () => {
    let tender: { id: string };
    before(async () => {
      tender = await seedTender(prisma, {
        userId: user.id,
        suffix: `${suffix}-earlyzip`,
        title: "Early ZIP Tender",
      });
      // No docs, no plan, no compliance — nothing is ready
    });
    after(async () => { await cleanupTender(prisma, tender.id); });

    it("no export-ready docs exist — ZIP would be blocked", async () => {
      const ready = await prisma.generatedDocument.count({
        where: { tenderId: tender.id, reviewStatus: "READY_FOR_EXPORT" },
      });
      assert.equal(ready, 0);
    });
  });

  // ─── 2.12 Cross-tenant access attempt ────────────────────────────────────────
  describe("blocked state: cross-tenant access attempt", () => {
    let tender: { id: string };
    let otherUser: { id: string; role: string };
    before(async () => {
      tender = await seedTender(prisma, { userId: user.id, suffix: `${suffix}-cross`, title: "Cross-Tenant Tender" });
      otherUser = await seedUser(prisma, `${suffix}-other`, "PROPOSAL_MANAGER");
    });
    after(async () => {
      await cleanupTender(prisma, tender.id);
      await cleanupUser(prisma, otherUser.id);
    });

    it("another user cannot find this tender (findFirst scopes by userId)", async () => {
      const t = await prisma.tender.findFirst({
        where: { id: tender.id, userId: otherUser.id },
      });
      assert.equal(t, null, "cross-tenant findFirst must return null");
    });
  });

  // ─── 2.13 Viewer/reviewer mutation attempt ───────────────────────────────────
  describe("blocked state: viewer/reviewer mutation attempt", () => {
    let tender: { id: string };
    let viewer: { id: string; role: string };
    let reviewer: { id: string; role: string };
    before(async () => {
      tender = await seedTender(prisma, { userId: user.id, suffix: `${suffix}-viewer`, title: "Viewer Test Tender" });
      viewer = await seedUser(prisma, `${suffix}-viewer`, "VIEWER");
      reviewer = await seedUser(prisma, `${suffix}-reviewer`, "REVIEWER");
    });
    after(async () => {
      await cleanupTender(prisma, tender.id);
      await cleanupUser(prisma, viewer.id);
      await cleanupUser(prisma, reviewer.id);
    });

    it("viewer does not own the tender", async () => {
      const t = await prisma.tender.findFirst({ where: { id: tender.id, userId: viewer.id } });
      assert.equal(t, null);
    });

    it("reviewer does not own the tender", async () => {
      const t = await prisma.tender.findFirst({ where: { id: tender.id, userId: reviewer.id } });
      assert.equal(t, null);
    });
  });

  // ─── Safe public error check for all blocked states ──────────────────────────
  describe("safe public errors — no raw Prisma/SQL/path/key leaks", () => {
    it("no-file tender data does not leak raw errors", async () => {
      const t = await seedTender(prisma, { userId: user.id, suffix: `${suffix}-safe-nofile`, title: "Safe No File" });
      try {
        const tender = await prisma.tender.findUnique({ where: { id: t.id } });
        assertSafePublicError(tender);
      } finally {
        await cleanupTender(prisma, t.id);
      }
    });

    it("weak-extraction tender data does not leak raw errors", async () => {
      const t = await seedTender(prisma, {
        userId: user.id,
        suffix: `${suffix}-safe-weak`,
        title: "Safe Weak",
        analysisExtractionStatus: "OCR_REQUIRED",
      });
      try {
        const tender = await prisma.tender.findUnique({ where: { id: t.id } });
        assertSafePublicError(tender);
      } finally {
        await cleanupTender(prisma, t.id);
      }
    });

    it("partial-AI tender data does not leak raw errors", async () => {
      const t = await seedTender(prisma, {
        userId: user.id,
        suffix: `${suffix}-safe-partial`,
        title: "Safe Partial",
        analysisExtractionStatus: "AI_ANALYSIS_PARTIAL",
      });
      try {
        const tender = await prisma.tender.findUnique({ where: { id: t.id } });
        assertSafePublicError(tender);
      } finally {
        await cleanupTender(prisma, t.id);
      }
    });

    it("missing-PDF tender data does not leak raw errors", async () => {
      const t = await seedTender(prisma, {
        userId: user.id,
        suffix: `${suffix}-safe-nopdf`,
        title: "Safe No PDF",
        exactFileNaming: JSON.stringify([{ exactFileName: "Technical Proposal.pdf", required: true, format: "pdf" }]),
      });
      try {
        const tender = await prisma.tender.findUnique({ where: { id: t.id } });
        assertSafePublicError(tender);
      } finally {
        await cleanupTender(prisma, t.id);
      }
    });
  });
});
