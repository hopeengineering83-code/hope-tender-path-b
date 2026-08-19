import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { Document, Packer, Paragraph, TextRun } from "docx";

const RUN = process.env.RUN_DB_INTEGRATION === "true";

async function makeSplitRunTechnicalDocx(): Promise<Buffer> {
  return Packer.toBuffer(new Document({
    sections: [{
      children: [
        new Paragraph({
          children: [
            new TextRun("Our technical methodology covers mobilisation, quality assurance, inspection, reporting and implementation sequencing. "),
            new TextRun({ text: "Financial ", bold: true }),
            new TextRun({ text: "proposal includes USD ", italics: true }),
            new TextRun("500,000 for consultancy services. "),
            new TextRun("The financial offer is submitted separately in the designated commercial envelope."),
          ],
        }),
        new Paragraph("The project team will maintain a documented inspection and test plan, hold-point register, progress reporting cycle and client coordination process throughout delivery."),
      ],
    }],
  }));
}

async function cleanup(prisma: any, userId: string) {
  await prisma.aiJob.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.tender.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.company.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
}

describe("auto-finalize split-run hygiene — real PostgreSQL chain", { skip: !RUN }, () => {
  it("repairs a previously failed split-run DOCX, rebinds integrity, validates it, and finalizes the required PDF", async () => {
    const { prisma } = await import("../lib/prisma");
    const { verifiedIntegrityDataFromBase64, verifyPersistedFileBytes } = await import("../lib/engine/persisted-byte-integrity");
    const { extractDocxVisibleText, documentHygieneIssues } = await import("../lib/engine/export-readiness");
    const { runAutoFinalizeAfterGeneration } = await import("../lib/ai-jobs/auto-finalize-continuation-service");

    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await prisma.user.create({
      data: {
        email: `autofin-split-run-${nonce}@example.test`,
        passwordHash: "unused",
        name: "Auto Finalize Split Run Owner",
        role: "PROPOSAL_MANAGER",
      },
    });

    try {
      await prisma.company.create({
        data: {
          userId: user.id,
          name: "Hope Engineering Test",
          address: "1 Test Way",
          email: "bids@example.test",
        },
      });

      const tender = await prisma.tender.create({
        data: {
          userId: user.id,
          title: `Split-run hygiene tender ${nonce}`,
          clientName: "Test Procuring Entity",
          reference: `SR-${nonce}`,
          exactFileNaming: "Technical-Proposal.pdf",
        },
      });

      const originalBytes = await makeSplitRunTechnicalDocx();
      const originalContent = originalBytes.toString("base64");
      const originalIntegrity = verifiedIntegrityDataFromBase64({
        fileContent: originalContent,
        filename: "Technical-Proposal.docx",
        claimedMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      const source = await prisma.generatedDocument.create({
        data: {
          tenderId: tender.id,
          name: "Technical Proposal",
          exactFileName: "Technical-Proposal.docx",
          exactOrder: 1,
          documentType: "TECHNICAL_PROPOSAL",
          format: "DOCX",
          generationStatus: "GENERATED",
          // Reproduce the retained Preview state after a previous canonical
          // rejection. A successful repair must invalidate this result and
          // send the new bytes back through PENDING -> canonical validation.
          validationStatus: "FAILED",
          fileContent: originalContent,
          ...originalIntegrity,
        },
      });

      const originalText = await extractDocxVisibleText(originalContent, "Technical-Proposal.docx");
      assert.ok(originalText);
      assert.ok(
        documentHygieneIssues(originalText, {
          name: source.name,
          exactFileName: source.exactFileName,
          documentType: source.documentType ?? undefined,
          format: source.format ?? undefined,
        }).length > 0,
        "fixture must reproduce the canonical hygiene rejection",
      );

      const job = await prisma.aiJob.create({
        data: {
          userId: user.id,
          tenderId: tender.id,
          jobType: "AUTO_FINALIZE",
          status: "RUNNING",
          input: "{}",
        },
      });

      const result = await runAutoFinalizeAfterGeneration(tender.id, user.id, job.id);

      assert.equal(result.exportRepair.repaired, 1, JSON.stringify(result.exportRepair));
      assert.equal(result.exportRepair.manualRequired, 0);
      assert.equal(result.validation.failed, 0, JSON.stringify(result.validation));
      assert.equal(result.validation.pending, 0, JSON.stringify(result.validation));
      assert.equal(result.pdfFinalization.finalized, 1, JSON.stringify(result.pdfFinalization));
      assert.equal(result.pdfFinalization.failed, 0, JSON.stringify(result.pdfFinalization));
      assert.deepEqual(result.blockers, [], `unexpected auto-finalize blocker: ${result.blockers.join("; ")}`);
      assert.equal(result.ok, true, `auto-finalize must converge: ${JSON.stringify(result)}`);

      const repaired = await prisma.generatedDocument.findUniqueOrThrow({
        where: { id: source.id },
        select: {
          name: true,
          exactFileName: true,
          documentType: true,
          format: true,
          fileContent: true,
          validationStatus: true,
          contentSha256: true,
          contentByteLength: true,
          contentMimeType: true,
          detectedFormat: true,
          integrityStatus: true,
        },
      });

      assert.equal(repaired.validationStatus, "VALIDATED", "repaired bytes must pass the canonical validator");
      assert.equal(repaired.integrityStatus, "VERIFIED");
      assert.notEqual(repaired.fileContent, originalContent, "the hygiene repair must produce new DOCX bytes");

      const integrity = verifyPersistedFileBytes({
        bytes: Buffer.from(repaired.fileContent ?? "", "base64"),
        filename: repaired.exactFileName ?? "Technical-Proposal.docx",
        claimedMimeType: repaired.contentMimeType,
        persisted: repaired,
      });
      assert.equal(integrity.integrityStatus, "VERIFIED", integrity.integrityFailureCode ?? "integrity must match repaired bytes");

      const repairedText = await extractDocxVisibleText(repaired.fileContent ?? "", repaired.exactFileName ?? "Technical-Proposal.docx");
      assert.ok(repairedText);
      assert.match(repairedText, /technical methodology covers mobilisation/i, "good technical content in the mixed paragraph must survive");
      assert.match(repairedText, /financial offer is submitted separately/i, "safe envelope wording must survive");
      assert.doesNotMatch(repairedText, /USD\s*500,000/i);
      assert.doesNotMatch(repairedText, /financial\s+proposal\s+includes/i);
      assert.deepEqual(
        documentHygieneIssues(repairedText, {
          name: repaired.name,
          exactFileName: repaired.exactFileName,
          documentType: repaired.documentType ?? undefined,
          format: repaired.format ?? undefined,
        }),
        [],
        "the exact canonical detector must accept the persisted repaired document",
      );

      const pdf = await prisma.generatedDocument.findFirst({
        where: {
          tenderId: tender.id,
          exactFileName: "Technical-Proposal.pdf",
          format: "PDF",
          generationStatus: { not: "SUPERSEDED" },
        },
        select: {
          fileContent: true,
          validationStatus: true,
          integrityStatus: true,
          contentSha256: true,
          contentByteLength: true,
          contentMimeType: true,
          detectedFormat: true,
          exactFileName: true,
        },
      });
      assert.ok(pdf, "the required PDF must be finalized after the repaired DOCX validates");
      assert.equal(Buffer.from(pdf!.fileContent ?? "", "base64").subarray(0, 5).toString("latin1"), "%PDF-");
      assert.equal(pdf!.validationStatus, "VALIDATED");
      assert.equal(pdf!.integrityStatus, "VERIFIED");

      // Retry proof: the repaired artifacts survive the durable retry without
      // reintroducing hygiene, integrity drift, or duplicate PDFs.
      const second = await runAutoFinalizeAfterGeneration(tender.id, user.id, job.id);
      assert.equal(second.pdfFinalization.failed, 0);
      assert.equal(second.pdfFinalization.finalized, 0, "retry must not re-render an existing valid PDF");
      assert.equal(second.pdfFinalization.skipped, 1);
      assert.deepEqual(second.blockers, []);
      assert.equal(second.ok, true);

      const activePdfCount = await prisma.generatedDocument.count({
        where: {
          tenderId: tender.id,
          exactFileName: "Technical-Proposal.pdf",
          generationStatus: { not: "SUPERSEDED" },
        },
      });
      assert.equal(activePdfCount, 1, "retry must preserve exactly one active required PDF");
    } finally {
      await cleanup(prisma, user.id);
    }
  });
});
