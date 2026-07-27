// Legal/Financial/Compliance records had no automatic auto-review path at
// all: autoVerifyCompanyKnowledge() only ever covered Expert/Project, so a
// company that uploads all its documents still had to click "Approve" in
// the Review Board for every legal/financial/compliance record — directly
// contradicting the product's "no human review is allowed, uploaded
// documents are the only evidence source" policy that Expert/Project
// already follow. This proves the extended auto-verification pass promotes
// a genuinely evidence-backed LFC record straight to REVIEWED with
// reviewedBy=SYSTEM_AUTO_VERIFIED, the same as Expert/Project, and that a
// record whose claimed values are NOT actually present in its linked
// source document's text stays blocked (AI_DRAFT) rather than being
// fabricated as REVIEWED.

import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash, randomUUID } from "node:crypto";
import { prisma, prismaReady } from "../lib/prisma";
import { autoVerifyCompanyKnowledge } from "../lib/company-auto-verification";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

function sourceBytes(text: string) {
  return {
    contentSha256: createHash("sha256").update(text).digest("hex"),
    contentByteLength: Buffer.byteLength(text),
  };
}

describe("autoVerifyCompanyKnowledge auto-reviews Legal/Financial/Compliance evidence — real PostgreSQL", () => {
  let userId: string;
  let companyId: string;
  let docId: string;
  let legalGoodId: string;
  let legalBadId: string;
  let financialGoodId: string;
  let complianceGoodId: string;

  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const user = await prisma.user.create({
      data: { email: `lfc-auto-review-${nonce}@example.test`, name: "LFC Auto Review Test", passwordHash: "test-hash" },
    });
    userId = user.id;
    const company = await prisma.company.create({ data: { userId, name: `LFC Auto Review Firm ${nonce}` } });
    companyId = company.id;

    const text = [
      "BUSINESS LICENSE CERTIFICATE",
      "License type: General Contracting License",
      "Certificate title: Federal Ministry of Trade Business License",
      "Issuing Authority: Ministry of Trade and Regional Integration",
      "Reference Number: BL-2024-88213",
      "Issue Date: 2024-01-15",
      "Expiry Date: 2030-01-14",
      "",
      "AUDITED FINANCIAL STATEMENT — FISCAL YEAR 2024",
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

    const doc = await prisma.companyDocument.create({
      data: {
        companyId,
        fileName: "company-legal-financial-compliance.pdf",
        originalFileName: "company-legal-financial-compliance.pdf",
        mimeType: "application/pdf",
        size: Buffer.byteLength(text),
        category: "LEGAL",
        extractedText: text,
        integrityStatus: "VERIFIED",
        ...sourceBytes(text),
        metadata: JSON.stringify({ extractionRevision: 1 }),
      },
    });
    docId = doc.id;

    const legalGood = await prisma.legalRecord.create({
      data: {
        companyId,
        recordType: "General Contracting License",
        title: "Federal Ministry of Trade Business License",
        authority: "Ministry of Trade and Regional Integration",
        referenceNumber: "BL-2024-88213",
        issueDate: new Date("2024-01-15"),
        expiryDate: new Date("2030-01-14"),
        trustLevel: "AI_DRAFT",
        sourceDocumentId: docId,
      },
    });
    legalGoodId = legalGood.id;

    const legalBad = await prisma.legalRecord.create({
      data: {
        companyId,
        recordType: "Environmental Permit",
        title: "Fabricated Environmental Compliance Certificate",
        referenceNumber: "ENV-FAKE-00000",
        trustLevel: "AI_DRAFT",
        sourceDocumentId: docId,
      },
    });
    legalBadId = legalBad.id;

    const financialGood = await prisma.financialRecord.create({
      data: {
        companyId,
        fiscalYear: 2024,
        recordType: "Annual Turnover",
        currency: "USD",
        amount: 2500000,
        trustLevel: "AI_DRAFT",
        sourceDocumentId: docId,
      },
    });
    financialGoodId = financialGood.id;

    const complianceGood = await prisma.companyComplianceRecord.create({
      data: {
        companyId,
        complianceType: "Quality Management System",
        title: "ISO 9001:2015 Certification",
        referenceNumber: "ISO-9001-77451",
        expiryDate: new Date("2029-06-30"),
        trustLevel: "AI_DRAFT",
        sourceDocumentId: docId,
      },
    });
    complianceGoodId = complianceGood.id;
  });

  after(async () => {
    await prisma.legalRecord.deleteMany({ where: { companyId } });
    await prisma.financialRecord.deleteMany({ where: { companyId } });
    await prisma.companyComplianceRecord.deleteMany({ where: { companyId } });
    await prisma.companyDocument.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("auto-promotes a genuinely evidence-backed legal record to REVIEWED with SYSTEM_AUTO_VERIFIED, and blocks one whose claims are not in the source text", async () => {
    const result = await autoVerifyCompanyKnowledge(companyId);
    assert.equal(result.legalVerified, 1);
    assert.equal(result.legalBlocked, 1);

    const good = await prisma.legalRecord.findUniqueOrThrow({ where: { id: legalGoodId } });
    assert.equal(good.trustLevel, "REVIEWED");
    assert.equal(good.reviewedBy, "SYSTEM_AUTO_VERIFIED");
    assert.ok(good.reviewedAt);
    assert.ok(good.reviewNotes);

    const bad = await prisma.legalRecord.findUniqueOrThrow({ where: { id: legalBadId } });
    assert.equal(bad.trustLevel, "AI_DRAFT");
    assert.equal(bad.reviewedBy, null);
  });

  it("auto-promotes a genuinely evidence-backed financial record to REVIEWED with SYSTEM_AUTO_VERIFIED", async () => {
    // Relies on the single autoVerifyCompanyKnowledge() call made by the
    // previous test — one pass verifies all record types together.
    const record = await prisma.financialRecord.findUniqueOrThrow({ where: { id: financialGoodId } });
    assert.equal(record.trustLevel, "REVIEWED");
    assert.equal(record.reviewedBy, "SYSTEM_AUTO_VERIFIED");
    assert.ok(record.reviewedAt);
  });

  it("auto-promotes a genuinely evidence-backed compliance record to REVIEWED with SYSTEM_AUTO_VERIFIED", async () => {
    const record = await prisma.companyComplianceRecord.findUniqueOrThrow({ where: { id: complianceGoodId } });
    assert.equal(record.trustLevel, "REVIEWED");
    assert.equal(record.reviewedBy, "SYSTEM_AUTO_VERIFIED");
    assert.ok(record.reviewedAt);
  });

  it("writes an audit log row distinct per record type", async () => {
    const logs = await prisma.auditLog.findMany({
      where: { action: { in: ["LEGAL_RECORD_AUTO_REVIEWED", "FINANCIAL_RECORD_AUTO_REVIEWED", "COMPLIANCE_RECORD_AUTO_REVIEWED"] }, userId },
    });
    assert.equal(logs.length, 3);
  });
});
