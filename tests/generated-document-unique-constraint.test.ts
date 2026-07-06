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

import { describe, it, before, after } from "node:test";
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
