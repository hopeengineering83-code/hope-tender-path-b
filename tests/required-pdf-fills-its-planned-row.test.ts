// A planned row is a promise of a file, not the file.
//
// WHY THIS FILE EXISTS
// --------------------
// A required PDF the tender names is carried as a PLANNED placeholder
// GeneratedDocument — same exactFileName, format PDF, no bytes — until
// something renders it. Two things in the automatic chain read that row as
// though it were the finished deliverable:
//
//   1. runPdfFinalization asked whether a row with that name and format PDF
//      already exists. The placeholder answered yes, so finalization was
//      SKIPPED, and the same row was then reported by canonical validation as
//      "[CONTROL_RECORD_ONLY] Document is a control, placeholder, or text-only
//      row. Generate or attach the real final file." and by export readiness as
//      UNGENERATED_PLANNED_DOCUMENTS. The owner was told to attach a file the
//      pipeline had just declined to produce.
//
//   2. Once finalization did run, it created the PDF beside its own
//      placeholder — and GeneratedDocument_tenderId_exactFileName_active_key
//      makes (tenderId, exactFileName) unique across non-superseded rows, so
//      the write threw and a rendered, byte-verified PDF was counted as
//      "failed to finalize".
//
// Reproduced on the real owner tender: AUTO_FINALIZE returned
// AUTO_FINALIZE_NOT_CONVERGED on every attempt with pdfFinalization
// {finalized: 0, skipped: 1} and then {finalized: 0, failed: 1}.
//
// The plan row IS the deliverable's identity; finalization gives it its bytes.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { Document, Packer, Paragraph } from "docx";

const RUN = process.env.RUN_DB_INTEGRATION === "true";

async function makeTechnicalDocx(): Promise<Buffer> {
  return Packer.toBuffer(new Document({
    sections: [{
      children: [
        new Paragraph("Technical Proposal"),
        new Paragraph("Submitted to: Test Procuring Entity"),
        new Paragraph("Our technical methodology covers mobilisation, survey, quality assurance, inspection, reporting and implementation sequencing across the whole assignment."),
        new Paragraph("The project team maintains a documented inspection and test plan, a hold-point register, a progress reporting cycle and a client coordination process throughout delivery."),
        new Paragraph("No pricing, rates or commercial terms appear in this technical envelope; the financial offer is submitted separately."),
      ],
    }],
  }));
}

describe("a required PDF is finalized into its planned row — real PostgreSQL", { skip: !RUN }, () => {
  it("renders the PDF instead of mistaking the placeholder for it, and fills that row in", async () => {
    const { prisma } = await import("../lib/prisma");
    const { verifiedIntegrityDataFromBase64 } = await import("../lib/engine/persisted-byte-integrity");
    const { runAutoFinalizeAfterGeneration } = await import("../lib/ai-jobs/auto-finalize-continuation-service");

    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await prisma.user.create({
      data: {
        email: `planned-pdf-row-${nonce}@example.test`,
        passwordHash: "unused",
        name: "Planned PDF Row Owner",
        role: "PROPOSAL_MANAGER",
      },
    });

    try {
      await prisma.company.create({
        data: { userId: user.id, name: "Hope Engineering Test", address: "1 Test Way", email: "bids@example.test" },
      });

      const tender = await prisma.tender.create({
        data: {
          userId: user.id,
          title: `Planned PDF row tender ${nonce}`,
          clientName: "Test Procuring Entity",
          reference: `PP-${nonce}`,
          exactFileNaming: "Technical-Proposal.pdf",
        },
      });

      const docxBytes = await makeTechnicalDocx();
      const docxContent = docxBytes.toString("base64");
      await prisma.generatedDocument.create({
        data: {
          tenderId: tender.id,
          name: "Technical Proposal",
          exactFileName: "Technical-Proposal.docx",
          exactOrder: 1,
          documentType: "TECHNICAL_PROPOSAL",
          format: "DOCX",
          generationStatus: "GENERATED",
          validationStatus: "PENDING",
          fileContent: docxContent,
          ...verifiedIntegrityDataFromBase64({
            fileContent: docxContent,
            filename: "Technical-Proposal.docx",
            claimedMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          }),
        },
      });

      // The placeholder the plan carries for the required PDF: right name,
      // right format, no bytes.
      const planned = await prisma.generatedDocument.create({
        data: {
          tenderId: tender.id,
          name: "Technical Proposal",
          exactFileName: "Technical-Proposal.pdf",
          exactOrder: 2,
          documentType: "TECHNICAL_PROPOSAL",
          format: "PDF",
          generationStatus: "PLANNED",
          validationStatus: "PENDING",
          reviewStatus: "NEEDS_REVIEW",
        },
      });

      const job = await prisma.aiJob.create({
        data: { userId: user.id, tenderId: tender.id, jobType: "AUTO_FINALIZE", status: "RUNNING", input: "{}" },
      });

      const result = await runAutoFinalizeAfterGeneration(tender.id, user.id, job.id);

      assert.equal(result.pdfFinalization.finalized, 1, JSON.stringify(result.pdfFinalization));
      assert.equal(result.pdfFinalization.skipped, 0, "the placeholder must not be mistaken for the finished PDF");
      assert.equal(result.pdfFinalization.failed, 0, JSON.stringify(result.pdfFinalization));

      // The SAME row now carries the bytes — no duplicate, no leftover
      // placeholder for the export gate to report as ungenerated.
      const filled = await prisma.generatedDocument.findUniqueOrThrow({
        where: { id: planned.id },
        select: { generationStatus: true, format: true, fileContent: true, contentByteLength: true, integrityStatus: true },
      });
      assert.equal(filled.generationStatus, "GENERATED");
      assert.equal(filled.format, "PDF");
      assert.equal(filled.integrityStatus, "VERIFIED");
      assert.ok((filled.contentByteLength ?? 0) > 1000, "the finalized PDF must carry real bytes");
      assert.equal(
        Buffer.from(filled.fileContent ?? "", "base64").subarray(0, 5).toString("latin1"),
        "%PDF-",
        "the filled row must hold an actual PDF",
      );

      const active = await prisma.generatedDocument.findMany({
        where: { tenderId: tender.id, exactFileName: "Technical-Proposal.pdf", generationStatus: { not: "SUPERSEDED" } },
        select: { id: true },
      });
      assert.equal(active.length, 1, "exactly one active row may carry the required file name");
      assert.equal(active[0].id, planned.id, "the plan row itself must become the deliverable");
    } finally {
      await prisma.aiJob.deleteMany({ where: { userId: user.id } }).catch(() => {});
      await prisma.tender.deleteMany({ where: { userId: user.id } }).catch(() => {});
      await prisma.company.deleteMany({ where: { userId: user.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    }
  });
});
