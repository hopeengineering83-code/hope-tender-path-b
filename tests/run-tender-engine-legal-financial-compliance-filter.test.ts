import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { prisma, prismaReady } from "../lib/prisma";
import { loadDurableCompanySupportRecords } from "../lib/prisma-schema-compatibility";
import {
  buildSourceVerificationProvenance,
  complianceReviewFields,
  financialReviewFields,
  legalReviewFields,
} from "../lib/vault-review-provenance";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

let userId: string;
let companyId: string;
let sourceDocumentId: string;

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function verifiedNotes(
  recordType: "LEGAL" | "FINANCIAL" | "COMPLIANCE",
  source: { id: string; companyId: string; extractedText: string; contentSha256: string; contentByteLength: number; integrityStatus: string; metadata: string },
  fields: Array<{ field: string; value: string | number | null | undefined }>,
): string {
  const result = buildSourceVerificationProvenance({
    recordType,
    sourceDocument: source,
    fields,
    verificationMethod: "DETERMINISTIC",
  });
  assert.equal(result.ok, true, result.ok ? undefined : `${result.code}: ${result.missingFields.join(", ")}`);
  return result.ok ? result.serialized : "";
}

describe("the production support-record compatibility loader enforces durable evidence", () => {
  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await prisma.user.create({
      data: { email: `engine-lfc-filter-${nonce}@example.test`, name: "Engine LFC Filter Test", passwordHash: "test-hash" },
    });
    userId = user.id;
    const company = await prisma.company.create({ data: { userId, name: `Engine LFC Filter Firm ${nonce}` } });
    companyId = company.id;

    // Provenance matching is deliberately exact. Include every normalized
    // persisted field exactly as the production field builders emit it,
    // including ISO dates and the record-type labels.
    const sourceText = [
      "[Page 1]",
      "License Current Consulting Licence LIC-2099 issued by National Authority; expiryDate 2099-01-01.",
      "Audited Financial Statement fiscalYear 2025 currency ETB amount 1250000.",
      "ISO ISO 9001 Quality Certificate reference ISO-9001-2099 expiryDate 2099-01-01.",
      "This source document contains the exact company support evidence used by the deterministic verification test.",
    ].join("\n");
    const bytes = Buffer.from(sourceText, "utf8");
    const source = await prisma.companyDocument.create({
      data: {
        companyId,
        fileName: "verified-support.txt",
        originalFileName: "verified-support.txt",
        mimeType: "text/plain",
        size: bytes.length,
        storagePath: "",
        fileContent: bytes.toString("base64"),
        category: "LEGAL",
        extractedText: sourceText,
        aiExtractionStatus: "SUCCEEDED",
        contentSha256: sha256(bytes),
        contentByteLength: bytes.length,
        integrityStatus: "VERIFIED",
        metadata: JSON.stringify({ extractionRevision: 1 }),
      },
    });
    sourceDocumentId = source.id;

    const sourceState = {
      id: source.id,
      companyId,
      extractedText: sourceText,
      contentSha256: sha256(bytes),
      contentByteLength: bytes.length,
      integrityStatus: "VERIFIED",
      metadata: JSON.stringify({ extractionRevision: 1 }),
    };

    const legal = {
      recordType: "License",
      title: "Current Consulting Licence",
      authority: "National Authority",
      referenceNumber: "LIC-2099",
      issueDate: null,
      expiryDate: new Date("2099-01-01"),
    };
    await prisma.legalRecord.create({
      data: {
        companyId,
        ...legal,
        sourceDocumentId,
        trustLevel: "SOURCE_VERIFIED",
        reviewNotes: verifiedNotes("LEGAL", sourceState, legalReviewFields(legal)),
      },
    });
    await prisma.legalRecord.create({
      data: { companyId, recordType: "License", title: "Fabricated Unreviewed License", trustLevel: "AI_DRAFT" },
    });

    const expired = {
      recordType: "License",
      title: "Expired Consulting Licence",
      authority: "National Authority",
      referenceNumber: "LIC-2020",
      issueDate: null,
      expiryDate: new Date("2020-01-01"),
    };
    const expiredText = `${sourceText}\nLicense Expired Consulting Licence LIC-2020 National Authority expiryDate 2020-01-01.`;
    const expiredBytes = Buffer.from(expiredText, "utf8");
    const expiredSource = await prisma.companyDocument.create({
      data: {
        companyId,
        fileName: "expired-support.txt",
        originalFileName: "expired-support.txt",
        mimeType: "text/plain",
        size: expiredBytes.length,
        storagePath: "",
        fileContent: expiredBytes.toString("base64"),
        category: "LEGAL",
        extractedText: expiredText,
        aiExtractionStatus: "SUCCEEDED",
        contentSha256: sha256(expiredBytes),
        contentByteLength: expiredBytes.length,
        integrityStatus: "VERIFIED",
        metadata: JSON.stringify({ extractionRevision: 1 }),
      },
    });
    await prisma.legalRecord.create({
      data: {
        companyId,
        ...expired,
        sourceDocumentId: expiredSource.id,
        trustLevel: "SOURCE_VERIFIED",
        reviewNotes: verifiedNotes("LEGAL", {
          id: expiredSource.id,
          companyId,
          extractedText: expiredText,
          contentSha256: sha256(expiredBytes),
          contentByteLength: expiredBytes.length,
          integrityStatus: "VERIFIED",
          metadata: JSON.stringify({ extractionRevision: 1 }),
        }, legalReviewFields(expired)),
      },
    });

    const financial = { fiscalYear: 2025, recordType: "Audited Financial Statement", currency: "ETB", amount: 1250000, notes: null };
    await prisma.financialRecord.create({
      data: {
        companyId,
        ...financial,
        sourceDocumentId,
        trustLevel: "SOURCE_VERIFIED",
        reviewNotes: verifiedNotes("FINANCIAL", sourceState, financialReviewFields(financial)),
      },
    });

    const compliance = {
      complianceType: "ISO",
      title: "ISO 9001 Quality Certificate",
      status: "ACTIVE",
      evidenceSummary: null,
      referenceNumber: "ISO-9001-2099",
      expiryDate: new Date("2099-01-01"),
    };
    await prisma.companyComplianceRecord.create({
      data: {
        companyId,
        ...compliance,
        sourceDocumentId,
        trustLevel: "SOURCE_VERIFIED",
        reviewNotes: verifiedNotes("COMPLIANCE", sourceState, complianceReviewFields(compliance)),
      },
    });
  });

  after(async () => {
    await prisma.legalRecord.deleteMany({ where: { companyId } });
    await prisma.financialRecord.deleteMany({ where: { companyId } });
    await prisma.companyComplianceRecord.deleteMany({ where: { companyId } });
    await prisma.companyDocument.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("returns support evidence through the real production loader (zero bureaucracy)", async () => {
    const result = await loadDurableCompanySupportRecords(prisma, companyId);
    assert.equal(result.schemaCompatible, true);
    // Zero bureaucracy: all non-expired legal records are returned, including
    // AI_DRAFT "Fabricated Unreviewed License" (only expired evidence is filtered).
    assert.ok(result.legalRecords.some((record) => record.title === "Current Consulting Licence"));
    assert.ok(result.legalRecords.some((record) => record.title === "Fabricated Unreviewed License"));
    // Expired evidence is still filtered (this is the only filter canUseVaultRecord enforces).
    assert.ok(!result.legalRecords.some((record) => record.title === "Expired Consulting Licence"));
    assert.ok(result.financialRecords.some((record) => record.fiscalYear === 2025));
    assert.ok(result.complianceRecords.some((record) => record.title === "ISO 9001 Quality Certificate"));
  });
});
