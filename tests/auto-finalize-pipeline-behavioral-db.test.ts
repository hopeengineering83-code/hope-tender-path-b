// Behavioral proof that the real finalization chain runs, and fails closed.
//
// runAutoFinalizeAfterGeneration is the application's actual bridge from
// generated DOCX documents to a downloadable package: it repairs grounding,
// validates, renders required PDFs via finalizeRequiredPdf, and reconciles the
// package manifest. Everything downstream of Run Engine depends on it.
//
// Its only existing coverage — tests/gap3-durable-auto-finalize.test.ts and
// tests/auto-finalize-continuation-gap4.test.ts — is readFileSync plus regex
// over the source. Those assert that certain calls are *written*, not that the
// chain *works*: they would stay green if the PDF renderer produced zero bytes,
// if an unvalidated DOCX were silently promoted into the package, or if the
// whole function returned success having finalized nothing.
//
// The individual stages are well covered on their own (pdf-finalization-safety
// exercises the renderer against real DOCX bytes; final-zip-integration and
// release-acceptance-final-package exercise ZIP assembly). What nothing covered
// is the orchestrator that wires them to persisted application data.
//
// These tests run the real function against real PostgreSQL with real DOCX
// bytes and assert on persisted rows.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { Document, Packer, Paragraph, TextRun } from "docx";

const RUN = process.env.RUN_DB_INTEGRATION === "true";

/** A real, openable DOCX with enough prose to survive the emptiness gates. */
async function realDocxBytes(heading: string): Promise<Buffer> {
  return Packer.toBuffer(new Document({
    sections: [{
      children: [
        new Paragraph({ children: [new TextRun({ text: heading, bold: true })] }),
        new Paragraph(
          "The contractor shall mobilise a site team within fourteen days of contract "
          + "award and maintain the works programme agreed at the pre-construction meeting.",
        ),
        new Paragraph(
          "Quality assurance follows the submitted inspection and test plan, with hold "
          + "points witnessed by the client representative before each concrete pour.",
        ),
      ],
    }],
  }));
}

async function seedTender(tag: string, opts: { validationStatus: string }) {
  const { prisma } = await import("../lib/prisma");
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const user = await prisma.user.create({
    data: {
      email: `${tag}-${nonce}@example.test`,
      passwordHash: "unused",
      name: `${tag} owner`,
      role: "PROPOSAL_MANAGER",
    },
  });
  await prisma.company.create({
    data: { userId: user.id, name: "Hope Engineering", address: "1 Test Way", email: "bids@example.test" },
  });

  // exactFileNaming drives which PDFs the chain is required to produce.
  const tender = await prisma.tender.create({
    data: {
      userId: user.id,
      title: `Auto-finalize pipeline ${nonce}`,
      clientName: "Ministry of Works",
      reference: `RFP-${nonce}`,
      exactFileNaming: "Technical-Proposal.pdf",
    },
  });

  // Fixture fidelity: build the source document exactly as normal generation
  // does. generate-elite.ts derives its integrity columns from the real bytes
  // via verifiedIntegrityDataFromBase64 and spreads the whole descriptor.
  //
  // An earlier version of this fixture hand-set only contentSha256,
  // contentByteLength and integrityStatus, leaving contentMimeType and
  // detectedFormat null. verifyPersistedFileBytes compares all four against a
  // fresh inspection, so that fixture could never verify — which made a real
  // production defect look like a fixture artifact.
  const { verifiedIntegrityDataFromBase64 } = await import("../lib/engine/persisted-byte-integrity");
  const bytes = await realDocxBytes("Technical Proposal");
  const fileContent = bytes.toString("base64");
  const integrity = verifiedIntegrityDataFromBase64({
    fileContent,
    filename: "Technical-Proposal.docx",
    claimedMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const source = await prisma.generatedDocument.create({
    data: {
      tenderId: tender.id,
      name: "Client-Ready Benchmark Technical Proposal",
      exactFileName: "Technical-Proposal.docx",
      documentType: "TECHNICAL_PROPOSAL",
      format: "DOCX",
      exactOrder: 1,
      generationStatus: "GENERATED",
      validationStatus: opts.validationStatus,
      fileContent,
      ...integrity,
    },
  });

  const job = await prisma.aiJob.create({
    data: { userId: user.id, tenderId: tender.id, jobType: "AUTO_FINALIZE", status: "RUNNING", input: "{}" },
  });

  return { prisma, user, tender, source, job };
}

async function cleanup(prisma: any, userId: string, tenderId: string) {
  await prisma.generatedDocument.deleteMany({ where: { tenderId } });
  await prisma.aiJob.deleteMany({ where: { userId } });
  await prisma.tender.deleteMany({ where: { userId } });
  await prisma.company.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
}

describe("auto-finalize pipeline — real chain against PostgreSQL", { skip: !RUN }, () => {
  it("renders a required PDF from a validated DOCX and persists real PDF bytes", async () => {
    const { runAutoFinalizeAfterGeneration } = await import("../lib/ai-jobs/auto-finalize-continuation-service");
    const { prisma, user, tender, job } = await seedTender("autofin-ok", { validationStatus: "VALIDATED" });

    try {
      const result = await runAutoFinalizeAfterGeneration(tender.id, user.id, job.id);

      assert.equal(
        result.pdfFinalization.finalized,
        1,
        `expected the required PDF to be rendered, got ${JSON.stringify(result.pdfFinalization)}`,
      );
      assert.equal(result.pdfFinalization.failed, 0);

      // The chain must have persisted a real PDF, not a row with a promise.
      const pdf = await prisma.generatedDocument.findFirst({
        where: { tenderId: tender.id, format: "PDF", exactFileName: "Technical-Proposal.pdf" },
        select: { fileContent: true, contentSha256: true, contentByteLength: true },
      });
      assert.ok(pdf, "the finalized PDF must exist as a GeneratedDocument row");

      const bytes = Buffer.from(pdf.fileContent ?? "", "base64");
      assert.ok(bytes.byteLength > 0, "the persisted PDF must have bytes");
      assert.equal(bytes.subarray(0, 5).toString("latin1"), "%PDF-", "must be a real PDF header");
      assert.equal(
        pdf.contentSha256,
        createHash("sha256").update(bytes).digest("hex"),
        "the recorded hash must match the persisted bytes",
      );
      assert.equal(pdf.contentByteLength, bytes.byteLength);
    } finally {
      await cleanup(prisma, user.id, tender.id);
    }
  });

  it("fails closed on a source that cannot validate — no PDF is fabricated", async () => {
    const { runAutoFinalizeAfterGeneration } = await import("../lib/ai-jobs/auto-finalize-continuation-service");
    const { prisma, user, tender, source, job } = await seedTender("autofin-unvalidated", { validationStatus: "PENDING" });

    try {
      // Seeding validationStatus PENDING is no longer enough to express this:
      // the pipeline's job is to validate PENDING documents, and a sound DOCX
      // is now correctly promoted to VALIDATED (previously it could not be,
      // because runCanonicalValidation read no integrity columns and failed
      // everything). The fail-closed rule under test is that a source which
      // genuinely CANNOT pass validation is never promoted into a required
      // PDF — so give it bytes that are not a DOCX at all.
      await prisma.generatedDocument.update({
        where: { id: source.id },
        data: {
          fileContent: Buffer.from("not a docx, just text pretending to be one").toString("base64"),
          contentSha256: null,
          contentByteLength: null,
          contentMimeType: null,
          detectedFormat: null,
          integrityStatus: "UNKNOWN",
        },
      });

      const result = await runAutoFinalizeAfterGeneration(tender.id, user.id, job.id);

      assert.equal(
        result.pdfFinalization.finalized,
        0,
        "an unvalidated DOCX must never be promoted into a required PDF",
      );

      const pdf = await prisma.generatedDocument.findFirst({
        where: { tenderId: tender.id, format: "PDF" },
      });
      assert.equal(pdf, null, "no PDF row may be created from an unvalidated source");
    } finally {
      await cleanup(prisma, user.id, tender.id);
    }
  });

  it("is idempotent across two executions — the required PDF survives a retry", async () => {
    // AUTO_FINALIZE is a durably retried job, so the second execution is the
    // normal case, not an edge case.
    //
    // Before the fix a retry destroyed the deliverable. Three separate causes:
    //
    //   1. runPdfFinalization hand-rolled the finalized PDF's integrity columns
    //      and hardcoded integrityStatus VERIFIED while leaving detectedFormat
    //      null, so verifyPersistedFileBytes could never match it.
    //   2. runCanonicalValidation selected documents without the integrity
    //      columns at all, so every document — including intact ones — came
    //      back FILE_BYTES_NOT_VERIFIED: LEGACY_INTEGRITY_UNKNOWN and was
    //      persisted validationStatus FAILED.
    //   3. needsSafeRepair let a healthy format="PDF" row into the DOCX hygiene
    //      repair, which rewrote it to format="DOCX" — the required PDF was
    //      gone, and the tender could never complete.
    const { runAutoFinalizeAfterGeneration } = await import("../lib/ai-jobs/auto-finalize-continuation-service");
    const { prisma, user, tender, job } = await seedTender("autofin-idem", { validationStatus: "VALIDATED" });

    try {
      const first = await runAutoFinalizeAfterGeneration(tender.id, user.id, job.id);
      assert.equal(first.pdfFinalization.finalized, 1, "the first run must render the required PDF");

      const afterFirst = await prisma.generatedDocument.findFirstOrThrow({
        where: { tenderId: tender.id, format: "PDF", exactFileName: "Technical-Proposal.pdf" },
        select: { id: true, contentSha256: true, validationStatus: true, integrityStatus: true },
      });
      assert.equal(afterFirst.validationStatus, "VALIDATED");
      assert.equal(afterFirst.integrityStatus, "VERIFIED");

      const second = await runAutoFinalizeAfterGeneration(tender.id, user.id, job.id);

      // No re-render, no duplicate: the existing PDF is recognised.
      assert.equal(second.pdfFinalization.finalized, 0, "the retry must not re-render");
      assert.equal(second.pdfFinalization.failed, 0, "the retry must not fail");
      assert.equal(second.pdfFinalization.skipped, 1, "the existing PDF must be skipped");

      const afterSecond = await prisma.generatedDocument.findFirst({
        where: { tenderId: tender.id, format: "PDF", exactFileName: "Technical-Proposal.pdf" },
        select: { id: true, contentSha256: true, validationStatus: true, integrityStatus: true, fileContent: true },
      });
      assert.ok(afterSecond, "the finalized PDF must still exist after a retry");
      assert.equal(afterSecond.id, afterFirst.id, "it must be the same row, not a replacement");
      assert.equal(afterSecond.contentSha256, afterFirst.contentSha256, "bytes must be unchanged");
      assert.equal(afterSecond.validationStatus, "VALIDATED", "no downgrade to FAILED");
      assert.equal(afterSecond.integrityStatus, "VERIFIED", "no integrity regression");
      assert.equal(
        Buffer.from(afterSecond.fileContent ?? "", "base64").subarray(0, 5).toString("latin1"),
        "%PDF-",
        "the PDF must remain a usable PDF, not be rewritten as DOCX",
      );

      const pdfCount = await prisma.generatedDocument.count({
        where: {
          tenderId: tender.id,
          exactFileName: "Technical-Proposal.pdf",
          generationStatus: { not: "SUPERSEDED" },
        },
      });
      assert.equal(pdfCount, 1, `exactly one active required PDF must exist, found ${pdfCount}`);
    } finally {
      await cleanup(prisma, user.id, tender.id);
    }
  });

  it("still records FAILED for a document the validator genuinely rejects", async () => {
    // Guards the narrowed failure classification: only circular workflow
    // reasons (`reviewStatus is ...`, `validationStatus is ...`) are excluded.
    // A real content rejection must still downgrade the document, or the fix
    // would have gutted validation instead of correcting it.
    const { runAutoFinalizeAfterGeneration } = await import("../lib/ai-jobs/auto-finalize-continuation-service");
    const { prisma, user, tender, job } = await seedTender("autofin-reject", { validationStatus: "VALIDATED" });

    try {
      // A PENDING document whose bytes are not a real DOCX: a genuine
      // integrity/content rejection, not a review-workflow state.
      await prisma.generatedDocument.create({
        data: {
          tenderId: tender.id,
          name: "Corrupt Annex",
          exactFileName: "Corrupt-Annex.docx",
          documentType: "TECHNICAL",
          format: "DOCX",
          generationStatus: "GENERATED",
          validationStatus: "PENDING",
          fileContent: Buffer.from("this is not a docx at all").toString("base64"),
        },
      });

      await runAutoFinalizeAfterGeneration(tender.id, user.id, job.id);

      const corrupt = await prisma.generatedDocument.findFirstOrThrow({
        where: { tenderId: tender.id, exactFileName: "Corrupt-Annex.docx" },
        select: { validationStatus: true },
      });
      assert.notEqual(
        corrupt.validationStatus,
        "VALIDATED",
        "a document with unusable bytes must never be recorded VALIDATED",
      );
    } finally {
      await cleanup(prisma, user.id, tender.id);
    }
  });

  it("never throws — a failure is reported, not crashed, so the worker survives", async () => {
    // The worker calls this directly; an exception would fail the AUTO_FINALIZE
    // job instead of surfacing an actionable blocker.
    const { runAutoFinalizeAfterGeneration } = await import("../lib/ai-jobs/auto-finalize-continuation-service");
    const { prisma, user, tender, job } = await seedTender("autofin-missing", { validationStatus: "VALIDATED" });

    try {
      // Remove the only source, leaving a required PDF with nothing to render.
      await prisma.generatedDocument.deleteMany({ where: { tenderId: tender.id } });

      const result = await runAutoFinalizeAfterGeneration(tender.id, user.id, job.id);
      assert.equal(result.pdfFinalization.finalized, 0);
      assert.equal(result.pdfFinalization.failed, 0, "a missing source is skipped, not an error");

      const pdf = await prisma.generatedDocument.findFirst({ where: { tenderId: tender.id, format: "PDF" } });
      assert.equal(pdf, null, "nothing may be fabricated when the source is gone");
    } finally {
      await cleanup(prisma, user.id, tender.id);
    }
  });
});
