// Real gap: the Plan-B legacy-data import (app/api/company/plan-b-import/
// route.ts) persists the company's own uploaded documents as CompanyDocument
// rows, but a record only gets sourceDocumentId set when the import payload
// itself declares which uploaded document produced it. When that declaration
// is missing (or doesn't match a document's fileName), the record is
// downgraded to AI_DRAFT with sourceDocumentId left null — and stays
// permanently stuck there, because BOTH automatic import-time promotion and
// a human's manual "Approve" in the Review Board use the exact same
// isDurablyReviewed()/assessReviewEvidence() gate, which requires a bound
// source document.
//
// remapUnlinkedVaultSources (lib/company-vault-source-remap.ts) closes this
// gap without weakening the evidence gate: it searches the company's OWN
// already-uploaded, byte-verified documents for one whose extracted text
// genuinely contains every one of a draft record's claimed field values, and
// links sourceDocumentId only when a real match is found. It never sets
// trustLevel to REVIEWED/SOURCE_VERIFIED itself — that stays gated behind
// the existing autoVerifyCompanyKnowledge pass and/or genuine human review.

import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { prisma, prismaReady } from "../lib/prisma";
import { remapUnlinkedVaultSources } from "../lib/company-vault-source-remap";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

const DOCUMENT_TEXT = [
  "LEGACY DATA IMPORT SOURCE DOCUMENT",
  "",
  "Name of Key Expert: Legacy Import Engineer Test",
  "Title: Senior Water Engineer",
  "Years of Experience: 12",
  "Discipline: Water Supply Engineering",
  "Sector: Water and Sanitation",
  "Certification: PMP",
  "",
  "Project Name: Legacy Import Water Project Test",
  "Client Name: Ministry of Water",
  "Country: Ethiopia",
  "Service Area: Design Supervision",
  "",
  "BUSINESS LICENSE CERTIFICATE",
  "License type: Business License",
  "Certificate title: Legacy Import Business License Test",
  "Issuing Authority: Ministry of Trade",
  "Reference Number: BL-LEGACY-2024-001",
  "Issue Date: 2024-01-15",
  "Expiry Date: 2027-01-14",
  "",
  "AUDITED FINANCIAL STATEMENT — FISCAL YEAR 2024",
  "Statement type: Annual Turnover Statement",
  "Total Annual Turnover: ETB 12345678 for fiscal year 2024.",
  "",
  "ISO 9001:2015 QUALITY MANAGEMENT CERTIFICATE",
  "Certificate: ISO 9001:2015 Quality Management Systems",
  "Certificate Reference: ISO-LEGACY-9001",
].join("\n");

describe("remapUnlinkedVaultSources — real PostgreSQL", () => {
  let userId: string;
  let companyId: string;
  let documentId: string;
  let expertId: string;
  let projectId: string;
  let legalRecordId: string;
  let financialRecordId: string;
  let complianceRecordId: string;
  let unmatchedExpertId: string;

  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await prisma.user.create({
      data: { email: `vault-remap-${nonce}@example.test`, name: "Vault Remap Test", passwordHash: "test-hash" },
    });
    userId = user.id;
    const company = await prisma.company.create({ data: { userId, name: `Vault Remap Firm ${nonce}` } });
    companyId = company.id;

    const document = await prisma.companyDocument.create({
      data: {
        companyId,
        fileName: "legacy-import-source.plan-b.json",
        originalFileName: "legacy-import-source.json",
        mimeType: "application/json",
        size: DOCUMENT_TEXT.length,
        storagePath: "",
        extractedText: DOCUMENT_TEXT,
        contentSha256: createHash("sha256").update(DOCUMENT_TEXT, "utf8").digest("hex"),
        contentByteLength: Buffer.byteLength(DOCUMENT_TEXT, "utf8"),
        integrityStatus: "VERIFIED",
      },
    });
    documentId = document.id;

    const expert = await prisma.expert.create({
      data: {
        companyId,
        fullName: "Legacy Import Engineer Test",
        title: "Senior Water Engineer",
        yearsExperience: 12,
        disciplines: JSON.stringify(["Water Supply Engineering"]),
        sectors: JSON.stringify(["Water and Sanitation"]),
        certifications: JSON.stringify(["PMP"]),
        trustLevel: "AI_DRAFT",
        sourceDocumentId: null,
      },
    });
    expertId = expert.id;

    const project = await prisma.project.create({
      data: {
        companyId,
        name: "Legacy Import Water Project Test",
        clientName: "Ministry of Water",
        country: "Ethiopia",
        serviceAreas: JSON.stringify(["Design Supervision"]),
        trustLevel: "AI_DRAFT",
        sourceDocumentId: null,
      },
    });
    projectId = project.id;

    const legalRecord = await prisma.legalRecord.create({
      data: {
        companyId,
        recordType: "Business License",
        title: "Legacy Import Business License Test",
        authority: "Ministry of Trade",
        referenceNumber: "BL-LEGACY-2024-001",
        issueDate: new Date("2024-01-15"),
        expiryDate: new Date("2027-01-14"),
        trustLevel: "AI_DRAFT",
        sourceDocumentId: null,
      },
    });
    legalRecordId = legalRecord.id;

    const financialRecord = await prisma.financialRecord.create({
      data: {
        companyId,
        fiscalYear: 2024,
        recordType: "Annual Turnover Statement",
        currency: "ETB",
        amount: 12345678,
        trustLevel: "AI_DRAFT",
        sourceDocumentId: null,
      },
    });
    financialRecordId = financialRecord.id;

    const complianceRecord = await prisma.companyComplianceRecord.create({
      data: {
        companyId,
        complianceType: "ISO 9001:2015 Quality Management Systems",
        title: "ISO 9001:2015 Quality Management Certificate",
        referenceNumber: "ISO-LEGACY-9001",
        trustLevel: "AI_DRAFT",
        sourceDocumentId: null,
      },
    });
    complianceRecordId = complianceRecord.id;

    const unmatchedExpert = await prisma.expert.create({
      data: {
        companyId,
        fullName: "Nobody Ever Uploaded Evidence For This Person",
        trustLevel: "AI_DRAFT",
        sourceDocumentId: null,
      },
    });
    unmatchedExpertId = unmatchedExpert.id;
  });

  after(async () => {
    await prisma.expert.deleteMany({ where: { companyId } });
    await prisma.project.deleteMany({ where: { companyId } });
    await prisma.legalRecord.deleteMany({ where: { companyId } });
    await prisma.financialRecord.deleteMany({ where: { companyId } });
    await prisma.companyComplianceRecord.deleteMany({ where: { companyId } });
    await prisma.companyDocument.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("links every draft whose exact field values genuinely appear in an already-uploaded document", async () => {
    const result = await remapUnlinkedVaultSources(companyId);
    assert.equal(result.expertsLinked, 1);
    assert.equal(result.projectsLinked, 1);
    assert.equal(result.legalRecordsLinked, 1);
    assert.equal(result.financialRecordsLinked, 1);
    assert.equal(result.complianceRecordsLinked, 1);

    const expert = await prisma.expert.findUnique({ where: { id: expertId } });
    assert.equal(expert?.sourceDocumentId, documentId);
    assert.equal(expert?.trustLevel, "AI_DRAFT", "remap must not itself promote trustLevel");

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    assert.equal(project?.sourceDocumentId, documentId);

    const legalRecord = await prisma.legalRecord.findUnique({ where: { id: legalRecordId } });
    assert.equal(legalRecord?.sourceDocumentId, documentId);

    const financialRecord = await prisma.financialRecord.findUnique({ where: { id: financialRecordId } });
    assert.equal(financialRecord?.sourceDocumentId, documentId);

    const complianceRecord = await prisma.companyComplianceRecord.findUnique({ where: { id: complianceRecordId } });
    assert.equal(complianceRecord?.sourceDocumentId, documentId);
  });

  it("never fabricates a link for a draft with no matching evidence anywhere in the company's documents", async () => {
    const unmatchedExpert = await prisma.expert.findUnique({ where: { id: unmatchedExpertId } });
    assert.equal(unmatchedExpert?.sourceDocumentId, null);
  });

  it("is idempotent — a second run finds nothing left to link", async () => {
    const result = await remapUnlinkedVaultSources(companyId);
    assert.equal(result.expertsLinked, 0);
    assert.equal(result.projectsLinked, 0);
    assert.equal(result.legalRecordsLinked, 0);
    assert.equal(result.financialRecordsLinked, 0);
    assert.equal(result.complianceRecordsLinked, 0);
  });

  it("records an audit trail for each remap", async () => {
    const logs = await prisma.auditLog.findMany({
      where: { userId, action: { in: ["EXPERT_SOURCE_REMAPPED", "PROJECT_SOURCE_REMAPPED", "LEGAL_RECORD_SOURCE_REMAPPED", "FINANCIAL_RECORD_SOURCE_REMAPPED", "COMPLIANCE_RECORD_SOURCE_REMAPPED"] } },
    });
    assert.equal(logs.length, 5);
  });
});
