// Regression test: Company Vault re-extraction must never report success for
// documents it did not actually process.
//
// The owner's Evidence gaps panel reported, for six real documents:
//   "DOCUMENTS 6 — 0 extracted"
//   "Source byte integrity is unverified — 6 document(s) cannot support
//    evidence until their stored bytes have a verified SHA-256 digest."
//
// Both facts are properties of the CompanyDocument row. The cause was that
// reextractAllCompanyDocuments excluded rows with no inline `fileContent` and
// no `storagePath` in its `where` clause, and `continue`d past any that got
// through, so those rows landed in neither `reextracted` nor `failedFiles`.
// A vault made entirely of such rows returned { reextracted: 0,
// failedFiles: [] } — a clean success report for a run that did nothing, with
// no stated reason and no action that could ever change it.
//
// These tests run the real function against a real PostgreSQL database and
// assert the row state and the returned report, not the source text.

import { before, after, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { prisma, prismaReady } from "../lib/prisma";
import { reextractAllCompanyDocuments } from "../lib/company-vault-reextraction";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

let userId: string;
let companyId: string;

describe("Company Vault re-extraction — documents whose bytes are gone", () => {
  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await prisma.user.create({
      data: {
        email: `vault-unrecoverable-${nonce}@example.test`,
        name: "Vault Unrecoverable Bytes Test",
        passwordHash: "test-hash",
      },
    });
    userId = user.id;
    const company = await prisma.company.create({
      data: {
        userId,
        name: `Unrecoverable Bytes Firm ${nonce}`,
        legalName: `Unrecoverable Bytes Firm ${nonce} Ltd`,
      },
    });
    companyId = company.id;
  });

  after(async () => {
    await prisma.expert.deleteMany({ where: { companyId } });
    await prisma.companyDocument.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  async function createByteless(fileName: string): Promise<string> {
    const doc = await prisma.companyDocument.create({
      data: {
        companyId,
        fileName,
        originalFileName: fileName,
        mimeType: "application/pdf",
        size: 2048,
        // Exactly the owner's shape: a real row, with no bytes behind it.
        storagePath: "",
        fileContent: null,
        category: "COMPANY_PROFILE",
        extractedText: null,
        aiExtractionStatus: "PENDING",
        metadata: JSON.stringify({ extractionRevision: 1, extractionStatus: "QUEUED" }),
      },
      select: { id: true },
    });
    return doc.id;
  }

  it("reports them instead of returning a silent clean success", async () => {
    const names = [
      "company-profile.pdf",
      "trade-licence.pdf",
      "tax-clearance.pdf",
      "audited-accounts-2024.pdf",
      "iso-9001-certificate.pdf",
      "expert-cv-dawit-bekele.pdf",
    ];
    for (const name of names) await createByteless(name);

    const result = await reextractAllCompanyDocuments(companyId);

    // The precise defect: six documents in, zero extracted, and — before the
    // fix — zero reported. A run that processes nothing must not look clean.
    assert.equal(result.reextracted, 0);
    assert.equal(
      result.unrecoverable.length,
      names.length,
      "every byteless document must be reported as unrecoverable",
    );
    assert.equal(
      result.failedFiles.length,
      names.length,
      "byteless documents must also count as failures, not vanish from the report",
    );
    assert.deepEqual(result.unrecoverable.map((doc) => doc.name).sort(), [...names].sort());
    for (const failure of result.failedFiles) {
      assert.equal(failure.code, "SOURCE_BYTES_UNAVAILABLE");
    }
  });

  it("records a terminal, self-explaining state on the row itself", async () => {
    const id = await createByteless("missing-bytes-single.pdf");

    await reextractAllCompanyDocuments(companyId);

    const row = await prisma.companyDocument.findUniqueOrThrow({
      where: { id },
      select: {
        contentSha256: true,
        integrityStatus: true,
        integrityFailureCode: true,
        aiExtractionStatus: true,
        aiExtractionError: true,
        metadata: true,
      },
    });

    // No digest may be invented for bytes that do not exist.
    assert.equal(row.contentSha256, null);
    assert.equal(row.integrityStatus, "MISSING");
    assert.equal(row.integrityFailureCode, "SOURCE_BYTES_UNAVAILABLE");
    assert.equal(row.aiExtractionStatus, "FAILED");

    // The row has to say what happened and what the owner can actually do,
    // rather than leaving the panel to render a bare "0 extracted".
    assert.ok(row.aiExtractionError, "an unrecoverable document must carry a stated reason");
    assert.match(row.aiExtractionError!, /no longer available/i);
    assert.match(row.aiExtractionError!, /upload the file again/i);

    const metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    assert.equal(metadata.extractionStatus, "SOURCE_BYTES_MISSING");
    assert.equal(metadata.extracted, false);
    assert.equal(metadata.integrityFailureCode, "SOURCE_BYTES_UNAVAILABLE");
  });

  it("is stable across repeated runs and never fabricates a verified digest", async () => {
    const id = await createByteless("missing-bytes-repeat.pdf");

    const first = await reextractAllCompanyDocuments(companyId);
    const second = await reextractAllCompanyDocuments(companyId);

    // Re-running is harmless but also genuinely does not help: the document
    // stays reported, so the UI can keep telling the truth about it.
    assert.ok(first.unrecoverable.some((doc) => doc.id === id));
    assert.ok(second.unrecoverable.some((doc) => doc.id === id));

    const row = await prisma.companyDocument.findUniqueOrThrow({
      where: { id },
      select: { contentSha256: true, integrityStatus: true },
    });
    assert.equal(row.contentSha256, null);
    assert.notEqual(row.integrityStatus, "VERIFIED");
  });

  it("still processes recoverable documents in the same vault", async () => {
    const profile = [
      "HOPE ENGINEERING PLC - COMPANY PROFILE",
      "Established 2009 in Addis Ababa, Ethiopia.",
      "The firm delivers water supply design and drainage master planning services",
      "for regional water bureaus across Ethiopia, with a permanent technical staff",
      "of civil engineers, hydrologists and surveyors.",
    ].join("\n");
    const usable = await prisma.companyDocument.create({
      data: {
        companyId,
        fileName: "recoverable-profile.txt",
        originalFileName: "recoverable-profile.txt",
        mimeType: "text/plain",
        size: Buffer.byteLength(profile),
        storagePath: "",
        fileContent: Buffer.from(profile, "utf8").toString("base64"),
        category: "COMPANY_PROFILE",
        extractedText: null,
        aiExtractionStatus: "PENDING",
        metadata: JSON.stringify({ extractionRevision: 1 }),
      },
      select: { id: true },
    });
    await createByteless("missing-bytes-alongside.pdf");

    const result = await reextractAllCompanyDocuments(companyId);

    // A byteless neighbour must not stop the documents that do have bytes.
    assert.ok(result.reextracted >= 1, "documents with real bytes must still be re-extracted");
    const row = await prisma.companyDocument.findUniqueOrThrow({
      where: { id: usable.id },
      select: { contentSha256: true, integrityStatus: true, extractedText: true },
    });
    assert.equal(row.integrityStatus, "VERIFIED");
    assert.ok(row.contentSha256, "a document with real bytes must get a verified digest");
    assert.match(row.extractedText ?? "", /HOPE ENGINEERING PLC/);
  });
});
