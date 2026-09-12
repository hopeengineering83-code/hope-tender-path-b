// Legal/Financial/Compliance records carry the same trustLevel/provenance
// columns as Expert/Project and are gated by the same canUseVaultRecord()
// authority, but autoVerifyCompanyKnowledge() only ever covered Expert and
// Project. A company that uploaded its trade licence, audited accounts and
// ISO certificate therefore still had to approve each one by hand in the
// Review Inbox before generation could use them — the exact human step the
// owner's operating model rules out for uploaded evidence.
//
// This proves the extended pass promotes a genuinely evidence-backed support
// record to SOURCE_VERIFIED through the same deriveAutomaticSourceVerification()
// decision the Expert/Project loops use, and — critically — that it refuses to
// promote a record whose claimed values are not actually present in its linked
// source document. Automatic verification must never become a way to launder
// an unverifiable claim into usable evidence.

import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash, randomUUID } from "node:crypto";
import { prisma, prismaReady } from "../lib/prisma";
import { autoVerifyCompanyKnowledge } from "../lib/company-auto-verification";
import { canUseVaultRecord, isDurablyReviewed, VAULT_REVIEW_CONSUMER_SELECT } from "../lib/vault-review-provenance";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

const SOURCE_TEXT = [
  "BUSINESS LICENSE CERTIFICATE",
  "License type: General Contracting License",
  "Certificate title: Federal Ministry of Trade Business License",
  "Issuing Authority: Ministry of Trade and Regional Integration",
  "Reference Number: BL-2024-88213",
  "Issue Date: 2024-01-15",
  "Expiry Date: 2030-01-14",
  "",
  "AUDITED FINANCIAL STATEMENT - FISCAL YEAR 2024",
  "Record type: Annual Turnover",
  "Currency: USD",
  "Amount: 2500000",
  "",
  "ISO 9001:2015 QUALITY MANAGEMENT CERTIFICATE",
  "Compliance type: Quality Management System",
  "Certificate title: ISO 9001:2015 Certification",
  "Reference Number: ISO-9001-77451",
  "Expiry Date: 2029-06-30",
].join("\n");

describe("autoVerifyCompanyKnowledge source-verifies Legal/Financial/Compliance evidence — real PostgreSQL", () => {
  let userId: string;
  let companyId: string;
  let legalGoodId: string;
  let legalUnsupportedId: string;
  let financialGoodId: string;
  let complianceGoodId: string;

  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const user = await prisma.user.create({
      data: { email: `lfc-auto-sv-${nonce}@example.test`, name: "LFC Auto SV Test", passwordHash: "test-hash" },
    });
    userId = user.id;
    companyId = (await prisma.company.create({ data: { userId, name: `LFC Auto SV Firm ${nonce}` } })).id;

    const doc = await prisma.companyDocument.create({
      data: {
        companyId,
        fileName: "company-support-records.pdf",
        originalFileName: "company-support-records.pdf",
        mimeType: "application/pdf",
        size: Buffer.byteLength(SOURCE_TEXT),
        category: "LEGAL",
        extractedText: SOURCE_TEXT,
        integrityStatus: "VERIFIED",
        contentSha256: createHash("sha256").update(SOURCE_TEXT).digest("hex"),
        contentByteLength: Buffer.byteLength(SOURCE_TEXT),
        metadata: JSON.stringify({ extractionRevision: 1 }),
      },
    });

    legalGoodId = (await prisma.legalRecord.create({
      data: {
        companyId,
        recordType: "General Contracting License",
        title: "Federal Ministry of Trade Business License",
        authority: "Ministry of Trade and Regional Integration",
        referenceNumber: "BL-2024-88213",
        issueDate: new Date("2024-01-15"),
        expiryDate: new Date("2030-01-14"),
        trustLevel: "AI_DRAFT",
        sourceDocumentId: doc.id,
      },
    })).id;

    // Linked to the same real document, but claims something the document
    // never says. This must stay blocked.
    legalUnsupportedId = (await prisma.legalRecord.create({
      data: {
        companyId,
        recordType: "Environmental Permit",
        title: "Fabricated Environmental Compliance Certificate",
        referenceNumber: "ENV-FAKE-00000",
        trustLevel: "AI_DRAFT",
        sourceDocumentId: doc.id,
      },
    })).id;

    financialGoodId = (await prisma.financialRecord.create({
      data: {
        companyId,
        fiscalYear: 2024,
        recordType: "Annual Turnover",
        currency: "USD",
        amount: 2500000,
        trustLevel: "AI_DRAFT",
        sourceDocumentId: doc.id,
      },
    })).id;

    complianceGoodId = (await prisma.companyComplianceRecord.create({
      data: {
        companyId,
        complianceType: "Quality Management System",
        title: "ISO 9001:2015 Certification",
        referenceNumber: "ISO-9001-77451",
        expiryDate: new Date("2029-06-30"),
        trustLevel: "AI_DRAFT",
        sourceDocumentId: doc.id,
      },
    })).id;

    await autoVerifyCompanyKnowledge(companyId);
  });

  after(async () => {
    await prisma.legalRecord.deleteMany({ where: { companyId } });
    await prisma.financialRecord.deleteMany({ where: { companyId } });
    await prisma.companyComplianceRecord.deleteMany({ where: { companyId } });
    await prisma.companyDocument.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("promotes an evidence-backed legal record to SOURCE_VERIFIED without inventing a human review", async () => {
    const record = await prisma.legalRecord.findUniqueOrThrow({ where: { id: legalGoodId } });
    assert.equal(record.trustLevel, "SOURCE_VERIFIED");
    assert.equal(record.reviewedBy, null, "no human reviewer may be invented");
    assert.equal(record.reviewedAt, null, "no human review timestamp may be invented");
    assert.ok(record.reviewNotes, "durable source-verification provenance must be persisted");
  });

  it("leaves a record whose claims are absent from its source document untouched", async () => {
    const record = await prisma.legalRecord.findUniqueOrThrow({ where: { id: legalUnsupportedId } });
    assert.equal(record.trustLevel, "AI_DRAFT", "an unverifiable claim must never be auto-promoted");
    assert.equal(record.reviewedBy, null);
    assert.equal(record.reviewNotes, null);
  });

  it("promotes evidence-backed financial and compliance records the same way", async () => {
    const financial = await prisma.financialRecord.findUniqueOrThrow({ where: { id: financialGoodId } });
    assert.equal(financial.trustLevel, "SOURCE_VERIFIED");
    assert.equal(financial.reviewedBy, null);

    const compliance = await prisma.companyComplianceRecord.findUniqueOrThrow({ where: { id: complianceGoodId } });
    assert.equal(compliance.trustLevel, "SOURCE_VERIFIED");
    assert.equal(compliance.reviewedBy, null);
  });

  it("the promoted records are usable for generation and export with no human click", async () => {
    const legal = await prisma.legalRecord.findUniqueOrThrow({
      where: { id: legalGoodId },
      select: VAULT_REVIEW_CONSUMER_SELECT.LEGAL,
    });
    assert.equal(isDurablyReviewed(legal), false, "still honestly not human-reviewed");
    for (const purpose of ["MATCHING", "GENERATION", "EXPORT"] as const) {
      assert.equal(canUseVaultRecord(legal, purpose), true, `${purpose} must accept upload-only support evidence`);
    }
  });

  it("re-running is idempotent and reports nothing left to promote", async () => {
    const second = await autoVerifyCompanyKnowledge(companyId);
    assert.equal(second.legalVerified, 0, "already-verified records must not be re-promoted");
    assert.equal(second.financialVerified, 0);
    assert.equal(second.complianceVerified, 0);
    assert.equal(second.legalBlocked, 1, "the unverifiable record stays blocked on every pass");
  });

  it("writes a distinct audit action per support record type", async () => {
    const logs = await prisma.auditLog.findMany({
      where: {
        userId,
        action: { in: ["LEGAL_RECORD_SOURCE_VERIFIED", "FINANCIAL_RECORD_SOURCE_VERIFIED", "COMPLIANCE_RECORD_SOURCE_VERIFIED"] },
      },
      select: { action: true },
    });
    assert.equal(logs.length, 3);
    assert.equal(new Set(logs.map((l) => l.action)).size, 3);
  });
});
