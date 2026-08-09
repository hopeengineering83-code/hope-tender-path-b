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

  const bytes = await realDocxBytes("Technical Proposal");
  const source = await prisma.generatedDocument.create({
    data: {
      tenderId: tender.id,
      name: "Technical-Proposal",
      exactFileName: "Technical-Proposal.docx",
      documentType: "TECHNICAL",
      format: "DOCX",
      generationStatus: "GENERATED",
      validationStatus: opts.validationStatus,
      fileContent: bytes.toString("base64"),
      contentSha256: createHash("sha256").update(bytes).digest("hex"),
      contentByteLength: bytes.byteLength,
      integrityStatus: "VERIFIED",
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

  it("fails closed on an unvalidated source — no PDF is fabricated", async () => {
    const { runAutoFinalizeAfterGeneration } = await import("../lib/ai-jobs/auto-finalize-continuation-service");
    const { prisma, user, tender, job } = await seedTender("autofin-unvalidated", { validationStatus: "PENDING" });

    try {
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
