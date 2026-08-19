// Integration test: tender-issued form reuse against real PostgreSQL.
//
// The claim this proves is a claim about bytes, and no amount of source-text
// assertion can establish it: the file that ends up on the GeneratedDocument
// must be byte-identical to the file the user uploaded. A re-encoded,
// re-rendered or regenerated lookalike would pass every structural test and
// still be the wrong document in a client's package.
//
// So this test uploads a real file, runs the real reuse path against the real
// Prisma client and the real storage adapter, reads the bytes back, and
// compares them byte-for-byte and by digest against what went in.
//
// It also pins the two things reuse must never do: invent human review state,
// and copy bytes whose stored digest no longer matches what was recorded at
// upload.

import { before, after, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { prisma, prismaReady } from "../lib/prisma";
import { getStorageAdapter } from "../lib/storage";
import { reuseTenderIssuedForm } from "../lib/engine/tender-issued-form-discovery";
import { readGeneratedDocumentContent } from "../lib/generated-document-content";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

// A byte sequence that is not valid UTF-8, so any accidental string round trip
// through the storage or database layer corrupts it detectably.
const FORM_BYTES = Buffer.concat([
  Buffer.from("%PDF-1.4\n"),
  Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x81, 0x0d, 0x0a, 0xc3, 0x28]),
  Buffer.from("Annex C — Bid Form\n%%EOF\n"),
]);
const FORM_SHA256 = createHash("sha256").update(FORM_BYTES).digest("hex");

let userId: string;
let tenderId: string;

/**
 * Tear a tender down the way production does.
 *
 * A bare tender.delete() cannot work here: deleting the tender cascades to
 * GeneratedDocument, whose AFTER DELETE trigger re-inserts a SubmissionPlanState
 * row for the tender being deleted, violating that row's foreign key. The
 * application's own deletion path (lib/tender/delete-tender.ts) removes
 * generated documents and the plan state explicitly before the tender for this
 * reason, so tests must follow the same order rather than invent their own.
 */
async function destroyTender(ids: { tenderId: string; userId: string }) {
  await prisma.generatedDocument.deleteMany({ where: { tenderId: ids.tenderId } });
  await prisma.submissionPlanState.deleteMany({ where: { tenderId: ids.tenderId } });
  await prisma.tender.deleteMany({ where: { id: ids.tenderId } });
  await prisma.user.deleteMany({ where: { id: ids.userId } });
}

async function makeTender(nonce: string) {
  const user = await prisma.user.create({
    data: {
      email: `form-reuse-${nonce}@example.test`,
      name: "Form Reuse Integration Test",
      passwordHash: "test-hash",
    },
  });
  const tender = await prisma.tender.create({
    data: {
      userId: user.id,
      title: `Form Reuse Tender ${nonce}`,
      clientName: "Form Reuse Procuring Authority",
      reference: `FR-${nonce}`,
      country: "Ethiopia",
      status: "DRAFT",
      stage: "TENDER_INTAKE",
    },
  });
  return { userId: user.id, tenderId: tender.id };
}

/** An uploaded Tender Intake file holding the real bytes. */
async function uploadIntakeFile(input: { tenderId: string; fileName: string; bytes: Buffer; recordedSha?: string }) {
  const saved = await getStorageAdapter().putFile(input.bytes, {
    fileName: input.fileName,
    mimeType: "application/pdf",
    tenderId: input.tenderId,
  });
  return prisma.tenderFile.create({
    data: {
      tenderId: input.tenderId,
      fileName: input.fileName,
      originalFileName: input.fileName,
      mimeType: "application/pdf",
      size: input.bytes.byteLength,
      storagePath: saved.storagePath,
      fileContent: saved.fileContent ?? null,
      contentSha256: input.recordedSha ?? createHash("sha256").update(input.bytes).digest("hex"),
      contentByteLength: input.bytes.byteLength,
      contentMimeType: "application/pdf",
      integrityStatus: "VERIFIED",
      deletionStatus: "ACTIVE",
    },
  });
}

async function plannedFormDocument(tenderId: string, exactFileName: string) {
  return prisma.generatedDocument.create({
    data: {
      tenderId,
      name: exactFileName,
      exactFileName,
      documentType: "FORM",
      format: "PDF",
      generationStatus: "PLANNED",
      validationStatus: "PENDING",
      reviewStatus: "REPLACE_WITH_ORIGINAL",
      reviewNotes: "Attach the tender-issued original before final export.",
    },
  });
}

describe("tender-issued form reuse — real PostgreSQL, real storage", () => {
  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    ({ userId, tenderId } = await makeTender(nonce));
  });

  after(async () => {
    if (tenderId && userId) await destroyTender({ tenderId, userId });
  });

  it("reuses the uploaded form's bytes without altering a single one", async () => {
    await uploadIntakeFile({ tenderId, fileName: "Annex C - Bid Form.pdf", bytes: FORM_BYTES });
    const doc = await plannedFormDocument(tenderId, "Annex C - Bid Form.pdf");

    const outcome = await reuseTenderIssuedForm({
      client: prisma,
      storage: getStorageAdapter(),
      tenderId,
      userId,
      documentId: doc.id,
      plannedFileName: "Annex C - Bid Form.pdf",
    });

    assert.equal(outcome.reused, true, `reuse should have succeeded: ${JSON.stringify(outcome)}`);
    if (!outcome.reused) return;
    assert.equal(outcome.sha256, FORM_SHA256, "the recorded digest must be the uploaded file's digest");
    assert.equal(outcome.byteLength, FORM_BYTES.byteLength);

    // The decisive check: read the persisted document back and compare bytes.
    const stored = await prisma.generatedDocument.findUniqueOrThrow({ where: { id: doc.id } });
    const readBack = await readGeneratedDocumentContent(stored as never);
    assert.ok(readBack?.buffer, "the reused document must have readable content");
    assert.ok(
      readBack.buffer.equals(FORM_BYTES),
      "the persisted bytes differ from the uploaded bytes — the client would receive a different file",
    );
    assert.equal(createHash("sha256").update(readBack.buffer).digest("hex"), FORM_SHA256);

    // And the digest columns the final-ZIP verifier reads must agree.
    assert.equal(stored.contentSha256, FORM_SHA256);
    assert.equal(stored.sha256, FORM_SHA256);
    assert.equal(stored.contentByteLength, FORM_BYTES.byteLength);
    assert.equal(stored.byteSize, FORM_BYTES.byteLength);
  });

  it("does not invent review, approval or export-ready state", async () => {
    const stored = await prisma.generatedDocument.findFirstOrThrow({
      where: { tenderId, exactFileName: "Annex C - Bid Form.pdf" },
    });
    assert.equal(stored.generationStatus, "GENERATED", "the content is real, so generation is done");
    assert.equal(stored.validationStatus, "PENDING", "canonical validation has not run yet");
    assert.equal(stored.reviewStatus, "PENDING", "nobody has completed or signed this form");
    assert.equal(stored.reviewedBy, null);
    assert.equal(stored.reviewedAt, null);
    assert.match(stored.reviewNotes ?? "", /machine:tender-issued-form-reuse/);
    assert.match(stored.reviewNotes ?? "", new RegExp(`sha256=${FORM_SHA256}`));
    assert.match(stored.reviewNotes ?? "", /Not reviewed/);
  });

  it("refuses to copy bytes whose stored digest no longer matches the upload record", async () => {
    // Records a digest that does not describe the stored bytes — the shape a
    // tampered or swapped storage object would have.
    await uploadIntakeFile({
      tenderId,
      fileName: "Annex D - Declaration Form.pdf",
      bytes: FORM_BYTES,
      recordedSha: "b".repeat(64),
    });
    const doc = await plannedFormDocument(tenderId, "Annex D - Declaration Form.pdf");

    const outcome = await reuseTenderIssuedForm({
      client: prisma,
      storage: getStorageAdapter(),
      tenderId,
      userId,
      documentId: doc.id,
      plannedFileName: "Annex D - Declaration Form.pdf",
    });

    assert.equal(outcome.reused, false, "mismatched bytes must never enter the package");
    if (outcome.reused) return;
    assert.match(outcome.reason, /CONTENT_HASH_MISMATCH/);

    const stored = await prisma.generatedDocument.findUniqueOrThrow({ where: { id: doc.id } });
    assert.equal(stored.reviewStatus, "REPLACE_WITH_ORIGINAL", "the blocker must stay in place");
    assert.equal(stored.generationStatus, "PLANNED");
  });

  it("will not reach another tenant's uploaded files", async () => {
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const other = await makeTender(`other-${nonce}`);
    try {
      const doc = await plannedFormDocument(tenderId, "Annex E - Rate Card Schedule.pdf");
      // The form exists — but on the OTHER tenant's tender.
      await uploadIntakeFile({
        tenderId: other.tenderId,
        fileName: "Annex E - Rate Card Schedule.pdf",
        bytes: FORM_BYTES,
      });

      const outcome = await reuseTenderIssuedForm({
        client: prisma,
        storage: getStorageAdapter(),
        tenderId,
        userId,
        documentId: doc.id,
        plannedFileName: "Annex E - Rate Card Schedule.pdf",
      });

      assert.equal(outcome.reused, false, "a file belonging to another account must never be reused");
      if (outcome.reused) return;
      assert.match(outcome.reason, /not among the uploaded Tender Intake files/);

      // And a caller who passes someone else's userId gets nothing either.
      const crossTenant = await reuseTenderIssuedForm({
        client: prisma,
        storage: getStorageAdapter(),
        tenderId: other.tenderId,
        userId,
        documentId: doc.id,
        plannedFileName: "Annex E - Rate Card Schedule.pdf",
      });
      assert.equal(crossTenant.reused, false);
      if (crossTenant.reused) return;
      assert.match(crossTenant.reason, /Tender not found for this account/);
    } finally {
      await destroyTender(other);
    }
  });

  it("leaves the blocker in place when the form is genuinely not in the uploads", async () => {
    const doc = await plannedFormDocument(tenderId, "Annex Z - Never Uploaded Form.pdf");
    const outcome = await reuseTenderIssuedForm({
      client: prisma,
      storage: getStorageAdapter(),
      tenderId,
      userId,
      documentId: doc.id,
      plannedFileName: "Annex Z - Never Uploaded Form.pdf",
    });
    assert.equal(outcome.reused, false);
    if (outcome.reused) return;
    assert.match(outcome.reason, /is not among the uploaded Tender Intake files/);

    const stored = await prisma.generatedDocument.findUniqueOrThrow({ where: { id: doc.id } });
    assert.equal(stored.reviewStatus, "REPLACE_WITH_ORIGINAL");
  });
});
