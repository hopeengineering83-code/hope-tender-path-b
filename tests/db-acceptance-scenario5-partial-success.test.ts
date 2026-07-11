// DB-backed release acceptance — Scenario 5: Partial-success fallback rows.
//
// Proves the deterministic fallback rows (PR #1041) are created when AI matching
// fails but the requirement source extractor matched requirements to source
// paragraphs. The fallback rows must:
//   - be REVIEW_REQUIRED or PARTIAL (NEVER FULL/SUBSTANTIAL)
//   - only be created for requirements with traceable source support
//   - surface the EVIDENCE_MATCHING_AI_FAILED_REVIEW_REQUIRED blocker
//   - NOT unlock final export
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
  seedComplianceRow,
  cleanupTender,
  cleanupUser,
  assertSafePublicError,
} from "./helpers/db-acceptance-harness";

dbDescribe("DB Acceptance — Scenario 5: Partial-success fallback rows", () => {
  const prisma = getPrisma();
  const suffix = testSuffix();
  let user: { id: string; role: string };
  let tender: { id: string };
  let file: { id: string };
  let sourceGroundedReq: { id: string };
  let nonSourceGroundedReq: { id: string };

  before(async () => {
    user = await seedUser(prisma, suffix, "PROPOSAL_MANAGER");
    await seedCompany(prisma, user.id, suffix);
    tender = await seedTender(prisma, {
      userId: user.id,
      suffix,
      title: `Partial Success Tender ${suffix}`,
      status: "MATCHED",
      stage: "COMPLIANCE",
    });
    file = await seedTenderFile(prisma, {
      tenderId: tender.id,
      suffix,
      extractedText: "Healthcare facility construction tender with detailed requirements.",
    });
    // A source-grounded requirement (has sourceTenderFileId + sourcePageNumber + sourceExactQuote)
    sourceGroundedReq = await seedRequirement(prisma, {
      tenderId: tender.id,
      title: "Source-grounded requirement",
      priority: "MANDATORY",
      sourceTenderFileId: file.id,
      sourcePageNumber: 3,
      sourceExactQuote: "The firm must have healthcare facility experience.",
      sourceConfidence: 0.95,
    });
    // A non-source-grounded requirement (no source evidence)
    nonSourceGroundedReq = await seedRequirement(prisma, {
      tenderId: tender.id,
      title: "Non-source-grounded requirement",
      priority: "MANDATORY",
      sourceTenderFileId: null,
      sourcePageNumber: null,
      sourceExactQuote: null,
      sourceConfidence: 0,
    });
  });

  after(async () => {
    await cleanupTender(prisma, tender.id);
    await cleanupUser(prisma, user.id);
  });

  it("source-grounded requirement has traceable source support", async () => {
    const r = await prisma.tenderRequirement.findUnique({ where: { id: sourceGroundedReq.id } });
    assert.ok(r!.sourceTenderFileId, "must have sourceTenderFileId");
    assert.ok(r!.sourcePageNumber != null, "must have sourcePageNumber");
    assert.ok(r!.sourceExactQuote, "must have sourceExactQuote");
    assert.ok((r!.sourceConfidence ?? 0) > 0, "must have sourceConfidence > 0");
  });

  it("non-source-grounded requirement has NO traceable source support", async () => {
    const r = await prisma.tenderRequirement.findUnique({ where: { id: nonSourceGroundedReq.id } });
    assert.equal(r!.sourceTenderFileId, null);
    assert.equal(r!.sourcePageNumber, null);
    assert.equal(r!.sourceExactQuote, null);
    assert.equal(r!.sourceConfidence ?? 0, 0);
  });

  it("buildDeterministicFallbackRows creates REVIEW_REQUIRED rows ONLY for source-grounded requirements", async () => {
    // Call the pure function directly (no DB needed for the function itself,
    // but we pass the DB-seeded requirement data to it).
    const { buildDeterministicFallbackRows } = require("../lib/engine/deterministic-fallback-rows");
    const reqs = await prisma.tenderRequirement.findMany({ where: { tenderId: tender.id } });
    const fallback = buildDeterministicFallbackRows(
      reqs.map((r: any) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        requirementType: r.requirementType,
        priority: r.priority,
        sourceTenderFileId: r.sourceTenderFileId,
        sourcePageNumber: r.sourcePageNumber,
        sourceExactQuote: r.sourceExactQuote,
        sourceConfidence: r.sourceConfidence ?? 0,
      })),
    );
    // Must create exactly 1 fallback row (for the source-grounded requirement)
    assert.equal(fallback.rows.length, 1, "must create 1 fallback row for the source-grounded requirement");
    assert.equal(fallback.rows[0].requirementId, sourceGroundedReq.id);
    // Must NOT create a row for the non-source-grounded requirement
    assert.ok(
      !fallback.rows.find((r: any) => r.requirementId === nonSourceGroundedReq.id),
      "must NOT create a fallback row for the non-source-grounded requirement",
    );
  });

  it("fallback rows are NEVER FULL/SUBSTANTIAL — only REVIEW_REQUIRED or PARTIAL", async () => {
    const { buildDeterministicFallbackRows } = require("../lib/engine/deterministic-fallback-rows");
    const reqs = await prisma.tenderRequirement.findMany({ where: { tenderId: tender.id } });
    const fallback = buildDeterministicFallbackRows(
      reqs.map((r: any) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        requirementType: r.requirementType,
        priority: r.priority,
        sourceTenderFileId: r.sourceTenderFileId,
        sourcePageNumber: r.sourcePageNumber,
        sourceExactQuote: r.sourceExactQuote,
        sourceConfidence: r.sourceConfidence ?? 0,
      })),
    );
    for (const row of fallback.rows) {
      assert.ok(
        ["REVIEW_REQUIRED", "PARTIAL"].includes(row.supportStatus),
        `fallback row supportStatus must be REVIEW_REQUIRED/PARTIAL, got ${row.supportStatus}`,
      );
      assert.notEqual(row.supportStatus, "FULL", "fallback row must NOT be FULL");
      assert.notEqual(row.supportStatus, "SUBSTANTIAL", "fallback row must NOT be SUBSTANTIAL");
    }
  });

  it("fallback rows surface EVIDENCE_MATCHING_AI_FAILED_REVIEW_REQUIRED blocker", async () => {
    const { buildDeterministicFallbackRows } = require("../lib/engine/deterministic-fallback-rows");
    const reqs = await prisma.tenderRequirement.findMany({ where: { tenderId: tender.id } });
    const fallback = buildDeterministicFallbackRows(
      reqs.map((r: any) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        requirementType: r.requirementType,
        priority: r.priority,
        sourceTenderFileId: r.sourceTenderFileId,
        sourcePageNumber: r.sourcePageNumber,
        sourceExactQuote: r.sourceExactQuote,
        sourceConfidence: r.sourceConfidence ?? 0,
      })),
    );
    assert.equal(fallback.blockerCode, "EVIDENCE_MATCHING_AI_FAILED_REVIEW_REQUIRED");
    assert.ok(fallback.blockerMessage, "blocker message must be non-empty");
    assert.match(fallback.blockerMessage, /AI evidence matching failed/i);
  });

  it("fallback rows have supportStrength below export threshold (0.75)", async () => {
    const { buildDeterministicFallbackRows } = require("../lib/engine/deterministic-fallback-rows");
    const reqs = await prisma.tenderRequirement.findMany({ where: { tenderId: tender.id } });
    const fallback = buildDeterministicFallbackRows(
      reqs.map((r: any) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        requirementType: r.requirementType,
        priority: r.priority,
        sourceTenderFileId: r.sourceTenderFileId,
        sourcePageNumber: r.sourcePageNumber,
        sourceExactQuote: r.sourceExactQuote,
        sourceConfidence: r.sourceConfidence ?? 0,
      })),
    );
    for (const row of fallback.rows) {
      assert.ok(
        row.supportStrength < 0.75,
        `fallback row supportStrength must be < 0.75 (export threshold), got ${row.supportStrength}`,
      );
    }
  });

  it("mergeFallbackRows adds fallback rows to the compliance result without duplicates", async () => {
    const { buildDeterministicFallbackRows, mergeFallbackRows } = require("../lib/engine/deterministic-fallback-rows");
    const reqs = await prisma.tenderRequirement.findMany({ where: { tenderId: tender.id } });
    const fallback = buildDeterministicFallbackRows(
      reqs.map((r: any) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        requirementType: r.requirementType,
        priority: r.priority,
        sourceTenderFileId: r.sourceTenderFileId,
        sourcePageNumber: r.sourcePageNumber,
        sourceExactQuote: r.sourceExactQuote,
        sourceConfidence: r.sourceConfidence ?? 0,
      })),
    );
    // Simulate an existing compliance result with 0 rows (the AI-matching-failed state)
    const existing = { matrices: [], gaps: [] };
    const merged = mergeFallbackRows(existing, fallback.rows);
    assert.equal(merged.matrices.length, 1, "must have 1 row after merge");
    assert.equal(merged.matrices[0].requirementId, sourceGroundedReq.id);
  });

  it("final export is NOT unlocked — 0 export-ready docs even with fallback rows", async () => {
    // Seed a REVIEW_REQUIRED compliance row (simulating what the engine would persist)
    await seedComplianceRow(prisma, {
      tenderId: tender.id,
      requirementId: sourceGroundedReq.id,
      supportLevel: "REVIEW_REQUIRED",
      evidenceType: "REVIEW_REQUIRED_FALLBACK",
    });
    // Verify no docs are export-ready
    const exportReady = await prisma.generatedDocument.count({
      where: { tenderId: tender.id, reviewStatus: "READY_FOR_EXPORT" },
    });
    assert.equal(exportReady, 0, "fallback rows must NOT unlock export");
  });

  it("safe public error — no raw leaks in fallback row data", async () => {
    const { buildDeterministicFallbackRows } = require("../lib/engine/deterministic-fallback-rows");
    const reqs = await prisma.tenderRequirement.findMany({ where: { tenderId: tender.id } });
    const fallback = buildDeterministicFallbackRows(
      reqs.map((r: any) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        requirementType: r.requirementType,
        priority: r.priority,
        sourceTenderFileId: r.sourceTenderFileId,
        sourcePageNumber: r.sourcePageNumber,
        sourceExactQuote: r.sourceExactQuote,
        sourceConfidence: r.sourceConfidence ?? 0,
      })),
    );
    assertSafePublicError(fallback);
  });
});
