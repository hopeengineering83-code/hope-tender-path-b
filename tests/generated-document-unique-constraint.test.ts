/**
 * DB regression tests for the GeneratedDocument partial unique constraint fix.
 *
 * Requires RUN_DB_INTEGRATION=true and a live PostgreSQL instance.
 *
 * Tests:
 * 1. Rerunning the engine succeeds when a prior document has the same exactFileName.
 * 2. Exactly one non-SUPERSEDED document exists per tender/exactFileName.
 * 3. Superseded history remains available.
 * 4. A forced persistence failure rolls back without leaving the tender with zero active documents.
 */

import { describe, it, before, beforeEach, after } from "node:test";
import { strict as assert } from "node:assert";

const RUN_DB = process.env.RUN_DB_INTEGRATION === "true";
const dbDescribe = RUN_DB ? describe : describe.skip;

dbDescribe("GeneratedDocument partial unique constraint — DB regression tests", () => {
  const { PrismaClient } = require("@prisma/client");
  let prisma: InstanceType<typeof PrismaClient>;
  let testUserId: string;
  let testTenderId: string;

  before(async () => {
    prisma = new PrismaClient();
    // Create a test user + tender
    testUserId = `test-user-${Date.now()}`;
    testTenderId = `test-tender-${Date.now()}`;
    await prisma.user.create({
      data: {
        id: testUserId,
        email: `test-${Date.now()}@test.local`,
        name: "Test User",
        passwordHash: "$2a$10$test",
        role: "ADMIN",
      },
    });
    await prisma.tender.create({
      data: {
        id: testTenderId,
        userId: testUserId,
        title: "Test Tender for Unique Constraint",
        clientName: "Test Client",
        submissionMethod: "Email",
        deadline: new Date("2026-12-30"),
      },
    });
    
    // Ensure the tender is truly clean before tests run
    await prisma.generatedDocument.deleteMany({
      where: { tenderId: testTenderId }
    }).catch(() => {});
  });

  beforeEach(async () => {
    // Clean up before each test to ensure strict isolation
    await prisma.generatedDocument.deleteMany({
      where: { tenderId: testTenderId }
    }).catch(() => {});
  });

  after(async () => {
    // Clean up
    await prisma.generatedDocument.deleteMany({ where: { tenderId: testTenderId } }).catch(() => {});
    await prisma.tender.delete({ where: { id: testTenderId } }).catch(() => {});
    await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("1. Rerunning the engine succeeds when a prior document has the same exactFileName", async () => {
    // Insert a first document with exactFileName
    await prisma.generatedDocument.create({
      data: {
        tenderId: testTenderId,
        name: "Technical Proposal",
        documentType: "TECHNICAL_PROPOSAL",
        format: "DOCX",
        exactFileName: "Technical-Proposal.docx",
        exactOrder: 1,
        generationStatus: "GENERATED",
        validationStatus: "PENDING",
        reviewStatus: "PENDING",
      },
    });

    // Now supersede it (as the engine would) and create a new one with the SAME exactFileName
    await prisma.$transaction(async (tx: any) => {
      // Supersede the existing active doc
      await tx.generatedDocument.updateMany({
        where: { tenderId: testTenderId, generationStatus: { not: "SUPERSEDED" } },
        data: { generationStatus: "SUPERSEDED", validationStatus: "SUPERSEDED", reviewStatus: "SUPERSEDED" },
      });
      // Create a new active doc with the same exactFileName — must NOT throw
      await tx.generatedDocument.create({
        data: {
          tenderId: testTenderId,
          name: "Technical Proposal v2",
          documentType: "TECHNICAL_PROPOSAL",
          format: "DOCX",
          exactFileName: "Technical-Proposal.docx",
          exactOrder: 1,
          generationStatus: "GENERATED",
          validationStatus: "PENDING",
          reviewStatus: "PENDING",
        },
      });
    });

    // Verify: exactly one non-SUPERSEDED doc with this exactFileName
    const active = await prisma.generatedDocument.findMany({
      where: { tenderId: testTenderId, exactFileName: "Technical-Proposal.docx", generationStatus: { not: "SUPERSEDED" } },
    });
    assert.equal(active.length, 1, "exactly one non-SUPERSEDED doc with this exactFileName must exist");
    assert.equal(active[0].name, "Technical Proposal v2", "the active doc must be the new one");
  });

  it("2. Exactly one non-SUPERSEDED document exists per tender/exactFileName", async () => {
    // Create an initial active doc
    await prisma.generatedDocument.create({
      data: {
        tenderId: testTenderId,
        name: "Technical Proposal",
        documentType: "TECHNICAL_PROPOSAL",
        format: "DOCX",
        exactFileName: "Technical-Proposal.docx",
        exactOrder: 1,
        generationStatus: "GENERATED",
        validationStatus: "PENDING",
        reviewStatus: "PENDING",
      },
    });

    // Try to create a SECOND non-SUPERSEDED doc with the same exactFileName — must fail
    try {
      await prisma.generatedDocument.create({
        data: {
          tenderId: testTenderId,
          name: "Technical Proposal v3",
          documentType: "TECHNICAL_PROPOSAL",
          format: "DOCX",
          exactFileName: "Technical-Proposal.docx",
          exactOrder: 1,
          generationStatus: "GENERATED",
          validationStatus: "PENDING",
          reviewStatus: "PENDING",
        },
      });
      assert.fail("should have thrown a unique constraint violation");
    } catch (err: any) {
      // Prisma P2002 = unique constraint violation
      assert.ok(err.code === "P2002" || err.message.includes("unique"), `expected unique constraint error, got: ${err.message}`);
    }
  });

  it("3. Superseded history remains available", async () => {
    // Insert and supersede a document
    const doc1 = await prisma.generatedDocument.create({
      data: {
        tenderId: testTenderId,
        name: "Technical Proposal v1",
        documentType: "TECHNICAL_PROPOSAL",
        format: "DOCX",
        exactFileName: "Technical-Proposal.docx",
        exactOrder: 1,
        generationStatus: "GENERATED",
        validationStatus: "PENDING",
        reviewStatus: "PENDING",
      },
    });

    // Supersede and create a new one
    await prisma.$transaction(async (tx: any) => {
      await tx.generatedDocument.updateMany({
        where: { tenderId: testTenderId, generationStatus: { not: "SUPERSEDED" } },
        data: { generationStatus: "SUPERSEDED", validationStatus: "SUPERSEDED", reviewStatus: "SUPERSEDED" },
      });
      await tx.generatedDocument.create({
        data: {
          tenderId: testTenderId,
          name: "Technical Proposal v2",
          documentType: "TECHNICAL_PROPOSAL",
          format: "DOCX",
          exactFileName: "Technical-Proposal.docx",
          exactOrder: 1,
          generationStatus: "GENERATED",
          validationStatus: "PENDING",
          reviewStatus: "PENDING",
        },
      });
    });

    const all = await prisma.generatedDocument.findMany({
      where: { tenderId: testTenderId, exactFileName: "Technical-Proposal.docx" },
      orderBy: { createdAt: "asc" },
    });
    // At least 2 rows: the original (SUPERSEDED) + the new active one
    assert.ok(all.length >= 2, `expected at least 2 rows (1 SUPERSEDED + 1 active), got ${all.length}`);
    const superseded = all.filter((d: any) => d.generationStatus === "SUPERSEDED");
    const active = all.filter((d: any) => d.generationStatus !== "SUPERSEDED");
    assert.ok(superseded.length >= 1, "at least 1 SUPERSEDED history row must exist");
    assert.equal(active.length, 1, "exactly 1 active row must exist");
    // The SUPERSEDED row must still have its original exactFileName (not nulled)
    assert.equal(superseded[0].exactFileName, "Technical-Proposal.docx", "SUPERSEDED history must retain exactFileName");
  });

  it("4. A forced persistence failure rolls back without leaving the tender with zero active documents", async () => {
    // Create an initial document
    await prisma.generatedDocument.create({
      data: {
        tenderId: testTenderId,
        name: "Technical Proposal",
        documentType: "TECHNICAL_PROPOSAL",
        format: "DOCX",
        exactFileName: "Technical-Proposal.docx",
        exactOrder: 1,
        generationStatus: "GENERATED",
        validationStatus: "PENDING",
        reviewStatus: "PENDING",
      },
    });

    // Count active docs before the failed transaction
    const activeBefore = await prisma.generatedDocument.count({
      where: { tenderId: testTenderId, generationStatus: { not: "SUPERSEDED" } },
    });
    assert.ok(activeBefore > 0, "must have active docs before the test");

    // Try a transaction that supersedes + creates, but the create FAILS
    // (we force failure by inserting an invalid tenderId on the create)
    try {
      await prisma.$transaction(async (tx: any) => {
        // Supersede all active docs
        await tx.generatedDocument.updateMany({
          where: { tenderId: testTenderId, generationStatus: { not: "SUPERSEDED" } },
          data: { generationStatus: "SUPERSEDED", validationStatus: "SUPERSEDED", reviewStatus: "SUPERSEDED" },
        });
        // Force failure: create with an invalid foreign key
        await tx.generatedDocument.create({
          data: {
            tenderId: "nonexistent-tender-id",
            name: "This should fail",
            documentType: "TECHNICAL_PROPOSAL",
            format: "DOCX",
            exactFileName: "Fail.docx",
            generationStatus: "GENERATED",
          },
        });
      });
      assert.fail("transaction should have rolled back");
    } catch (err: any) {
      // Expected — FK violation or similar
    }

    // Verify: the supersede was rolled back — active docs still exist
    const activeAfter = await prisma.generatedDocument.count({
      where: { tenderId: testTenderId, generationStatus: { not: "SUPERSEDED" } },
    });
    assert.equal(activeAfter, activeBefore, "active docs must be unchanged after rollback (supersede was rolled back)");
  });
});

// ─── Source pins: every document creator respects the partial unique index ───
// The index (tenderId, exactFileName) WHERE non-SUPERSEDED means a creator
// that matches or updates SUPERSEDED rows can resurrect preserved history or
// collide with the active row. These pins keep every named-file creator on
// the ACTIVE-only + graceful-conflict pattern.

import { readFileSync } from "node:fs";

describe("GeneratedDocument creators — ACTIVE-only lookups + graceful P2002 (source pins)", () => {
  it("regenerate-cvs matches ACTIVE rows only (never mutates SUPERSEDED history)", () => {
    const src = readFileSync("app/api/tenders/[id]/regenerate-cvs/route.ts", "utf8");
    assert.ok(
      /exactFileName: fileName, generationStatus: \{ not: "SUPERSEDED" \}/.test(src),
      "regenerate-cvs lookup must exclude SUPERSEDED rows",
    );
  });

  it("regenerate-cvs catches P2002 on create and converges to updating the winner", () => {
    const src = readFileSync("app/api/tenders/[id]/regenerate-cvs/route.ts", "utf8");
    // The route may use EITHER the P2002 convergence pattern OR a transactional
    // generation gate (withTransactionalGenerationGate) that serializes writes
    // via a tender mutation lock, making P2002 impossible. Both are valid
    // approaches to the concurrent-create race.
    const usesP2002Convergence = src.includes('(createErr as { code?: string })?.code === "P2002"')
      && (src.includes("P2002 convergence") || src.includes("converge"))
      && src.includes("P2002 convergence failed: the concurrent winner was deleted");
    const usesTransactionalGate = src.includes("withTransactionalGenerationGate")
      && src.includes("$transaction");
    assert.ok(
      usesP2002Convergence || usesTransactionalGate,
      "regenerate-cvs must either catch P2002 and converge, OR use a transactional generation gate to serialize writes",
    );
  });

  it("generate-missing-plan-files: ACTIVE-only fallback lookup + P2002 convergence instead of a 500", () => {
    const src = readFileSync("app/api/tenders/[id]/generate-missing-plan-files/route.ts", "utf8")
      + readFileSync("lib/engine/missing-plan-file-generation.ts", "utf8");
    const activeFilters = src.match(/generationStatus: \{ not: "SUPERSEDED" \}/g) ?? [];
    assert.ok(activeFilters.length >= 3, "all lookups (primary, fallback, P2002 winner) must exclude SUPERSEDED rows");
    assert.ok(src.includes('(createErr as { code?: string })?.code === "P2002"'), "create race must be caught");
    assert.ok(src.includes("Converge") || src.includes("converge"), "P2002 must converge to updating the winner, not fail the route");
    // Must NOT silently skip when the winner is deleted — must push to skipped
    // so the user has visibility.
    assert.ok(
      src.includes("P2002 convergence failed: winner deleted"),
      "generate-missing-plan-files must surface winner-deleted in skipped (no silent drop)",
    );
  });

  it("generate-elite Technical-Proposal upsert: ACTIVE-only lookup + P2002 convergence (no Serializable)", () => {
    const src = readFileSync("lib/engine/generate-elite.ts", "utf8");
    // The Technical-Proposal.docx upsert must filter to ACTIVE rows.
    // The guard is the ACTIVE-only filter, not the literal file name. The
    // proposal is now written to the CONFIRMED PLAN's file name (resolved into
    // `proposalFileName`) instead of a hardcoded "Technical-Proposal.docx", so
    // pinning the literal failed while the invariant it protects — never match
    // a SUPERSEDED row — was untouched.
    assert.ok(
      /exactFileName: (?:"Technical-Proposal\.docx"|proposalFileName), generationStatus: \{ not: "SUPERSEDED" \}/.test(src),
      "generate-elite proposal findFirst must exclude SUPERSEDED rows",
    );
    // Must catch P2002 on create and converge.
    assert.ok(
      src.includes('(createErr as { code?: string })?.code === "P2002"'),
      "generate-elite Technical-Proposal create must catch P2002",
    );
    // Must NOT use Serializable isolation (causes P2034 on concurrent CV writes
    // via the SubmissionPlanState trigger).
    assert.ok(
      !/isolationLevel:\s*["']Serializable["']/.test(src),
      "generate-elite must NOT use Serializable isolation (causes P2034 on concurrent CV writes)",
    );
  });

  it("generate-elite per-expert CV upsert: ACTIVE-only lookup + P2002 convergence", () => {
    const src = readFileSync("lib/engine/generate-elite.ts", "utf8");
    // The CV upsert must filter to ACTIVE rows.
    assert.ok(
      /exactFileName: fileName, generationStatus: \{ not: "SUPERSEDED" \}/.test(src),
      "generate-elite CV findFirst must exclude SUPERSEDED rows",
    );
    // The CV upsert must catch P2002 (the CV create runs in Promise.all over
    // experts, so concurrent same-name collisions are possible if the user
    // clicks /generate twice in quick succession).
    const cvCreateBlock = src.match(/exactFileName: fileName,[\s\S]*?catch \(createErr\)[\s\S]*?code === "P2002"/);
    assert.ok(
      cvCreateBlock,
      "generate-elite CV create must catch P2002 and converge",
    );
  });

  it("generate-elite target findFirst (by documentType) filters to ACTIVE rows", () => {
    // Gap A fix: the `target` findFirst at the top of the Technical-Proposal
    // block must also filter on generationStatus: { not: "SUPERSEDED" }.
    // Without this, a SUPERSEDED row with documentType TECHNICAL_PROPOSAL
    // could be resurrected back to GENERATED — corrupting audit history.
    const src = readFileSync("lib/engine/generate-elite.ts", "utf8");
    // Find the target findFirst block — search for the documentType + generationStatus
    // within the same where clause.
    const targetIdx = src.indexOf('const target = await prisma.generatedDocument.findFirst');
    assert.ok(targetIdx > -1, "must find the target findFirst");
    const targetBlock = src.slice(targetIdx, targetIdx + 800);
    assert.ok(
      // EXPRESSION_OF_INTEREST joined the list: on an EOI tender that document
      // IS the main narrative, and the quality validator rejects
      // documentType=TECHNICAL_PROPOSAL there. Assert the filter exists and
      // still covers the original types rather than pinning the exact array.
      /documentType: \{ in: \[[^\]]*"TECHNICAL_PROPOSAL"[^\]]*"PROPOSAL"[^\]]*"METHODOLOGY"[^\]]*\] \}/.test(targetBlock),
      "target findFirst must filter by documentType",
    );
    assert.ok(
      targetBlock.includes('generationStatus: { not: "SUPERSEDED" }'),
      "target findFirst must filter on generationStatus: { not: 'SUPERSEDED' }",
    );
  });

  it("generate-elite Technical-Proposal P2002 convergence surfaces winner-deleted (no silent skip)", () => {
    // Gap B fix: when the winner is deleted between the failed create and the
    // convergence lookup, the code must NOT silently skip. It must throw or
    // log an error so the user has visibility.
    const src = readFileSync("lib/engine/generate-elite.ts", "utf8");
    assert.ok(
      src.includes("P2002 convergence failed for Technical-Proposal"),
      "Technical-Proposal P2002 convergence must surface winner-deleted failure",
    );
  });

  it("generate-elite per-expert CV P2002 convergence surfaces winner-deleted (no silent skip)", () => {
    // Gap C fix: when the winner is deleted, the CV P2002 convergence must
    // throw so Promise.allSettled records it as "rejected" and cvFailed is
    // incremented — no false "generated N CVs" count.
    const src = readFileSync("lib/engine/generate-elite.ts", "utf8");
    assert.ok(
      src.includes("P2002 convergence failed for CV"),
      "CV P2002 convergence must surface winner-deleted failure",
    );
  });
});
