// Integration test: official Vault document inclusion against real PostgreSQL.
//
// The old code's worst property cannot be caught by reading source: it wrote
// the new bytes into fileContent while leaving contentSha256/byteSize holding
// the PREVIOUS document's values. The row then looked perfectly healthy and
// carried a digest describing a file that was no longer there. Only persisting
// real bytes and reading the row back afterwards proves that is fixed.
//
// This also pins the two states that must never be invented: VALIDATED without
// canonical validation, and READY_FOR_EXPORT (plus a DocumentReview) without a
// person.

import { before, after, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { prisma, prismaReady } from "../lib/prisma";
import { getStorageAdapter } from "../lib/storage";
import { includeVaultDocumentInPackage } from "../lib/engine/vault-document-package-inclusion";
import { readGeneratedDocumentContent } from "../lib/generated-document-content";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

const LICENCE_BYTES = Buffer.concat([
  Buffer.from("%PDF-1.7\n"),
  Buffer.from([0x00, 0xf0, 0x9f, 0x92, 0xa9, 0xff, 0xfe, 0x01]),
  Buffer.from("Trade Licence 2026 — Official\n%%EOF\n"),
]);
const LICENCE_SHA = createHash("sha256").update(LICENCE_BYTES).digest("hex");

let userId: string;
let companyId: string;
let tenderId: string;

async function makeVaultDocument(input: { fileName: string; bytes: Buffer; integrityStatus?: string; recordedSha?: string }) {
  const saved = await getStorageAdapter().putFile(input.bytes, {
    fileName: input.fileName,
    mimeType: "application/pdf",
    companyId,
  });
  return prisma.companyDocument.create({
    data: {
      companyId,
      fileName: input.fileName,
      originalFileName: input.fileName,
      mimeType: "application/pdf",
      size: input.bytes.byteLength,
      storagePath: saved.storagePath,
      fileContent: saved.fileContent ?? null,
      category: "LEGAL_REGISTRATION",
      contentSha256: input.recordedSha ?? createHash("sha256").update(input.bytes).digest("hex"),
      contentByteLength: input.bytes.byteLength,
      contentMimeType: "application/pdf",
      integrityStatus: input.integrityStatus ?? "VERIFIED",
    },
  });
}

/** A package row carrying a STALE digest from earlier content. */
async function makePackageRow(exactFileName: string) {
  const stale = Buffer.from("earlier draft content that is about to be replaced");
  return prisma.generatedDocument.create({
    data: {
      tenderId,
      name: exactFileName,
      exactFileName,
      documentType: "LEGAL",
      format: "PDF",
      generationStatus: "PLANNED",
      validationStatus: "PENDING",
      reviewStatus: "REPLACE_WITH_ORIGINAL",
      fileContent: stale.toString("base64"),
      contentSha256: createHash("sha256").update(stale).digest("hex"),
      contentByteLength: stale.byteLength,
      sha256: createHash("sha256").update(stale).digest("hex"),
      byteSize: stale.byteLength,
    },
  });
}

describe("official Vault document inclusion — real PostgreSQL, real storage", () => {
  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await prisma.user.create({
      data: { email: `vault-incl-${nonce}@example.test`, name: "Vault Inclusion Test", passwordHash: "test-hash", role: "ADMIN" },
    });
    userId = user.id;
    const company = await prisma.company.create({ data: { userId, name: `Vault Inclusion Co ${nonce}` } });
    companyId = company.id;
    const tender = await prisma.tender.create({
      data: { userId, title: `Vault Inclusion Tender ${nonce}`, status: "DRAFT", stage: "TENDER_INTAKE" },
    });
    tenderId = tender.id;
  });

  after(async () => {
    // Generated documents and the plan-state projection must go before the
    // tender: the AFTER DELETE trigger on GeneratedDocument re-inserts a
    // SubmissionPlanState row, which would violate its foreign key mid-cascade.
    if (tenderId) {
      await prisma.generatedDocument.deleteMany({ where: { tenderId } });
      await prisma.submissionPlanState.deleteMany({ where: { tenderId } });
      await prisma.tender.deleteMany({ where: { id: tenderId } });
    }
    if (companyId) await prisma.company.deleteMany({ where: { id: companyId } });
    if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("replaces the row's bytes AND its digest together", async () => {
    const vault = await makeVaultDocument({ fileName: "Trade Licence 2026.pdf", bytes: LICENCE_BYTES });
    const row = await makePackageRow("Trade Licence 2026.pdf");
    const staleDigest = row.contentSha256;

    const outcome = await includeVaultDocumentInPackage({
      client: prisma,
      storage: getStorageAdapter(),
      tenderId,
      userId,
      documentId: row.id,
      vaultDocumentId: vault.id,
    });

    assert.equal(outcome.included, true, `inclusion should have succeeded: ${JSON.stringify(outcome)}`);
    if (!outcome.included) return;

    const stored = await prisma.generatedDocument.findUniqueOrThrow({ where: { id: row.id } });
    const readBack = await readGeneratedDocumentContent(stored as never);
    assert.ok(readBack?.buffer, "the included document must have readable content");
    assert.ok(readBack.buffer.equals(LICENCE_BYTES), "the official bytes must be present unchanged");

    // The defect: bytes replaced, digest left describing the old content.
    assert.notEqual(stored.contentSha256, staleDigest, "the stale digest must not survive");
    assert.equal(stored.contentSha256, LICENCE_SHA);
    assert.equal(stored.sha256, LICENCE_SHA);
    assert.equal(stored.contentByteLength, LICENCE_BYTES.byteLength);
    assert.equal(stored.byteSize, LICENCE_BYTES.byteLength);
    assert.equal(
      createHash("sha256").update(readBack.buffer).digest("hex"),
      stored.contentSha256,
      "the recorded digest must describe the bytes actually stored",
    );
  });

  it("leaves validation and approval to the systems that do them", async () => {
    const stored = await prisma.generatedDocument.findFirstOrThrow({
      where: { tenderId, exactFileName: "Trade Licence 2026.pdf" },
    });
    assert.equal(stored.generationStatus, "GENERATED");
    assert.equal(stored.validationStatus, "PENDING", "canonical validation has not run");
    assert.equal(stored.reviewStatus, "PENDING", "no person has approved this for a client");
    assert.equal(stored.reviewedBy, null);
    assert.equal(stored.reviewedAt, null);
    assert.match(stored.reviewNotes ?? "", /machine:vault-document-inclusion/);
    assert.match(stored.reviewNotes ?? "", /Not validated and not reviewed/);

    const reviews = await prisma.documentReview.findMany({ where: { documentId: stored.id } });
    assert.equal(reviews.length, 0, "including a file must not create a review record");
  });

  it("refuses a Vault document that never passed byte verification", async () => {
    const vault = await makeVaultDocument({
      fileName: "Unverified Certificate.pdf",
      bytes: LICENCE_BYTES,
      integrityStatus: "UNKNOWN",
    });
    const row = await makePackageRow("Unverified Certificate.pdf");

    const outcome = await includeVaultDocumentInPackage({
      client: prisma, storage: getStorageAdapter(), tenderId, userId,
      documentId: row.id, vaultDocumentId: vault.id,
    });

    assert.equal(outcome.included, false);
    if (outcome.included) return;
    assert.match(outcome.reason, /has not passed byte verification/);

    const stored = await prisma.generatedDocument.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(stored.reviewStatus, "REPLACE_WITH_ORIGINAL", "the blocker must stay in place");
  });

  it("refuses bytes whose digest no longer matches the verified record", async () => {
    const vault = await makeVaultDocument({
      fileName: "Tampered Registration.pdf",
      bytes: LICENCE_BYTES,
      recordedSha: "d".repeat(64),
    });
    const row = await makePackageRow("Tampered Registration.pdf");

    const outcome = await includeVaultDocumentInPackage({
      client: prisma, storage: getStorageAdapter(), tenderId, userId,
      documentId: row.id, vaultDocumentId: vault.id,
    });

    assert.equal(outcome.included, false);
    if (outcome.included) return;
    assert.match(outcome.reason, /CONTENT_HASH_MISMATCH/);
  });

  it("will not reach another company's Vault", async () => {
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const otherUser = await prisma.user.create({
      data: { email: `vault-other-${nonce}@example.test`, name: "Other", passwordHash: "h", role: "ADMIN" },
    });
    const otherCompany = await prisma.company.create({ data: { userId: otherUser.id, name: `Other Co ${nonce}` } });
    try {
      const foreign = await prisma.companyDocument.create({
        data: {
          companyId: otherCompany.id,
          fileName: "Foreign Licence.pdf", originalFileName: "Foreign Licence.pdf",
          mimeType: "application/pdf", size: LICENCE_BYTES.byteLength,
          storagePath: "", fileContent: LICENCE_BYTES.toString("base64"),
          category: "LEGAL_REGISTRATION", integrityStatus: "VERIFIED",
          contentSha256: LICENCE_SHA, contentByteLength: LICENCE_BYTES.byteLength,
        },
      });
      const row = await makePackageRow("Foreign Licence.pdf");

      const outcome = await includeVaultDocumentInPackage({
        client: prisma, storage: getStorageAdapter(), tenderId, userId,
        documentId: row.id, vaultDocumentId: foreign.id,
      });

      assert.equal(outcome.included, false, "another company's document must never enter this package");
      if (outcome.included) return;
      assert.match(outcome.reason, /Vault document not found for this company/);
    } finally {
      await prisma.companyDocument.deleteMany({ where: { companyId: otherCompany.id } });
      await prisma.company.deleteMany({ where: { id: otherCompany.id } });
      await prisma.user.deleteMany({ where: { id: otherUser.id } });
    }
  });
});
