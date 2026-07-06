import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { prisma, prismaReady } from "../lib/prisma";
import { resolveEffectiveTenderFacts, isValidReferenceNumber, parseFlexibleDeadline } from "../lib/engine/effective-tender-facts";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.warn("Skipping metadata authority tests");
  process.exit(0);
}

describe("Metadata Authority & Effective Facts", () => {
  let tenderId: string;

  before(async () => {
    await prismaReady;
    const t = await prisma.tender.create({
      data: {
        title: "Test Tender",
        clientName: "Test Client",
        referenceNumber: "RFP/CONSULTANCY", // Letter only
        submissionMethod: "Email",
        status: "DRAFT",
        stage: "TENDER_INTAKE"
      }
    });
    tenderId = t.id;
  });

  after(async () => {
    if (tenderId) {
       await prisma.tender.delete({ where: { id: tenderId } }).catch(() => {});
    }
  });

  it("allows letter-only reference number", () => {
    assert.ok(isValidReferenceNumber("RFP/CONSULTANCY"));
    assert.ok(isValidReferenceNumber("AA/PROC/ARCH"));
    assert.ok(!isValidReferenceNumber("Not"));
    assert.ok(!isValidReferenceNumber("N/A"));
  });

  it("normalizes submission method 'Email' to EMAIL", async () => {
    const facts = await resolveEffectiveTenderFacts(tenderId);
    assert.strictEqual(facts.submissionMethod.value, "EMAIL");
    assert.strictEqual(facts.submissionMethod.authority, "SOURCE_GROUNDED_CONFIRMED");
  });

  it("parses flexible deadline '25 August 2026'", () => {
    const res = parseFlexibleDeadline("25 August 2026");
    assert.ok(res.date instanceof Date);
    assert.strictEqual(res.authority, "SOURCE_GROUNDED_CONFIRMED");
  });

  it("flags ambiguous deadline '05/06/2026' as CANDIDATE_NEEDS_REVIEW", () => {
    const res = parseFlexibleDeadline("05/06/2026");
    assert.strictEqual(res.authority, "CANDIDATE_NEEDS_REVIEW");
    assert.ok(res.isAmbiguous);
  });

  it("rejects garbage reference 'Not'", () => {
    assert.ok(!isValidReferenceNumber("Not"));
  });
});
