import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { prisma, prismaReady } from "../lib/prisma";
import { prepareCompanyVaultForEngine } from "../lib/engine/prepare-company-vault";

const RUN = process.env.RUN_DB_INTEGRATION === "true";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

function sourceText(marker: string) {
  return [
    `COMPANY LEGAL FINANCIAL AND COMPLIANCE EVIDENCE — ${marker}`,
    "LICENSE Grade 1 Competence Certificate Ministry of Urban and Infrastructure LIC-001",
    "2017 AUDITED_FINANCIAL ETB 12345 Audited financial statement",
    "TAX_CLEARANCE Tax Clearance Certificate ACTIVE TC-001",
    "This authenticated company evidence package contains the exact current support-record identities and values.",
  ].join("\n");
}

describe("Company Vault support-record zero-bureaucracy reconciliation — real PostgreSQL", { skip: !RUN }, () => {
  let userId = "";
  let companyId = "";
  let originalDocumentId = "";

  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${Math.random()}`;
    const user = await prisma.user.create({ data: { email: `support-reconcile-${nonce}@example.test`, passwordHash: "test" } });
    userId = user.id;
    companyId = (await prisma.company.create({ data: { userId, name: `Support Evidence Company ${nonce}` } })).id;

    const text = sourceText("ORIGINAL");
    const original = await prisma.companyDocument.create({ data: {
      companyId,
      fileName: "company-support-evidence.txt",
      originalFileName: "company-support-evidence.txt",
      category: "OTHER",
      mimeType: "text/plain",
      size: Buffer.byteLength(text),
      contentByteLength: Buffer.byteLength(text),
      contentSha256: hash(text),
      integrityStatus: "VERIFIED",
      extractedText: text,
      metadata: JSON.stringify({ extractionRevision: 1 }),
    } });
    originalDocumentId = original.id;

    await prisma.legalRecord.create({ data: {
      companyId,
      recordType: "LICENSE",
      title: "Grade 1 Competence Certificate",
      authority: "Ministry of Urban and Infrastructure",
      referenceNumber: "LIC-001",
      trustLevel: "MANUAL_DRAFT",
    } });
    await prisma.financialRecord.create({ data: {
      companyId,
      fiscalYear: 2017,
      recordType: "AUDITED_FINANCIAL",
      currency: "ETB",
      amount: 12345,
      notes: "Audited financial statement",
      trustLevel: "MANUAL_DRAFT",
    } });
    await prisma.companyComplianceRecord.create({ data: {
      companyId,
      complianceType: "TAX_CLEARANCE",
      title: "Tax Clearance Certificate",
      status: "ACTIVE",
      referenceNumber: "TC-001",
      trustLevel: "MANUAL_DRAFT",
    } });
  });

  after(async () => {
    await prisma.legalRecord.deleteMany({ where: { companyId } });
    await prisma.financialRecord.deleteMany({ where: { companyId } });
    await prisma.companyComplianceRecord.deleteMany({ where: { companyId } });
    await prisma.companyDocument.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("links and source-verifies legal, financial and compliance drafts without human review", async () => {
    const first = await prepareCompanyVaultForEngine(userId);
    assert.equal(first?.sourceRemap.legalRecordsLinked, 1);
    assert.equal(first?.sourceRemap.financialRecordsLinked, 1);
    assert.equal(first?.sourceRemap.complianceRecordsLinked, 1);
    assert.equal(first?.sourceVerification.legalVerified, 1);
    assert.equal(first?.sourceVerification.financialVerified, 1);
    assert.equal(first?.sourceVerification.complianceVerified, 1);

    const [legal, financial, compliance] = await Promise.all([
      prisma.legalRecord.findFirstOrThrow({ where: { companyId } }),
      prisma.financialRecord.findFirstOrThrow({ where: { companyId } }),
      prisma.companyComplianceRecord.findFirstOrThrow({ where: { companyId } }),
    ]);
    for (const record of [legal, financial, compliance]) {
      assert.equal(record.trustLevel, "SOURCE_VERIFIED");
      assert.equal(record.sourceDocumentId, originalDocumentId);
      assert.equal(record.reviewedBy, null);
      assert.equal(record.reviewedAt, null);
    }
  });

  it("automatically replaces stale support provenance and restores SOURCE_VERIFIED", async () => {
    const replacementText = sourceText("REPLACEMENT");
    const replacement = await prisma.companyDocument.create({ data: {
      companyId,
      fileName: "company-support-evidence-replacement.txt",
      originalFileName: "company-support-evidence-replacement.txt",
      category: "OTHER",
      mimeType: "text/plain",
      size: Buffer.byteLength(replacementText),
      contentByteLength: Buffer.byteLength(replacementText),
      contentSha256: hash(replacementText),
      integrityStatus: "VERIFIED",
      extractedText: replacementText,
      metadata: JSON.stringify({ extractionRevision: 2 }),
    } });

    const supersededText = [
      "SUPERSEDED SUPPORT SOURCE — no current legal, financial or compliance identity remains here.",
      "The original uploaded evidence was replaced. This text intentionally cannot verify any current support record.",
    ].join("\n");
    await prisma.companyDocument.update({
      where: { id: originalDocumentId },
      data: {
        extractedText: supersededText,
        size: Buffer.byteLength(supersededText),
        contentByteLength: Buffer.byteLength(supersededText),
        contentSha256: hash(supersededText),
        integrityStatus: "VERIFIED",
        metadata: JSON.stringify({ extractionRevision: 2 }),
      },
    });

    const second = await prepareCompanyVaultForEngine(userId);
    assert.equal(second?.sourceRemap.legalRecordsLinked, 1);
    assert.equal(second?.sourceRemap.financialRecordsLinked, 1);
    assert.equal(second?.sourceRemap.complianceRecordsLinked, 1);
    assert.equal(second?.sourceVerification.legalVerified, 1);
    assert.equal(second?.sourceVerification.financialVerified, 1);
    assert.equal(second?.sourceVerification.complianceVerified, 1);

    const [legal, financial, compliance] = await Promise.all([
      prisma.legalRecord.findFirstOrThrow({ where: { companyId } }),
      prisma.financialRecord.findFirstOrThrow({ where: { companyId } }),
      prisma.companyComplianceRecord.findFirstOrThrow({ where: { companyId } }),
    ]);
    for (const record of [legal, financial, compliance]) {
      assert.equal(record.trustLevel, "SOURCE_VERIFIED");
      assert.equal(record.sourceDocumentId, replacement.id);
      assert.equal(record.reviewedBy, null);
      assert.equal(record.reviewedAt, null);
    }
  });
});