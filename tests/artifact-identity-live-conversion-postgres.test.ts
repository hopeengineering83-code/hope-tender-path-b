// End-to-end proof against real PostgreSQL:
//   validated DOCX source → real PDF conversion → %PDF- bytes → validation →
//   current export candidate, and a deliberately mismatched artifact fails
//   closed at every one of those stages.
//
// The live defect this pins was document
// cd1dacc5-d415-47c3-acda-27bc55442574: named "Technical Proposal.pdf",
// declared DOCX, holding DOCX bytes, VALIDATED. Reproduced on this head before
// the fix — checkFullExportReadiness reported only workflow reasons, so
// auto-finalize's runCanonicalValidation (which filters those out and marks
// everything else VALIDATED) actively validated it.
//
// These assertions run against real rows, real bytes and the real finaliser.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import JSZip from "jszip";

import { prisma } from "../lib/prisma";
import { finalizeRequiredPdf } from "../lib/engine/workflow/pdf-finalizer";
import { checkFullExportReadiness } from "../lib/engine/export-readiness";
import {
  deriveDocumentOutputState,
  isFinalExportCandidateDocument,
} from "../lib/engine/document-output-state";

const RUN = process.env.RUN_DB_INTEGRATION === "true";

async function makeDocx(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

test("validated DOCX source converts to real PDF bytes and becomes the current export candidate", {
  skip: !RUN,
  timeout: 120_000,
}, async () => {
  const user = await prisma.user.create({
    data: { email: `identity-${randomUUID()}@test.local`, passwordHash: "unused", role: "PROPOSAL_MANAGER" },
  });
  let tenderId: string | null = null;
  try {
    const tender = await prisma.tender.create({
      data: { userId: user.id, title: "Water Supply Design", status: "DRAFT", clientName: "Ministry of Water" },
    });
    tenderId = tender.id;

    const docx = await makeDocx("Our approach to the water supply design assignment. ".repeat(40));
    const source = await prisma.generatedDocument.create({
      data: {
        tenderId: tender.id, name: "Technical Proposal", exactFileName: "Technical-Proposal.docx",
        documentType: "TECHNICAL_PROPOSAL", format: "DOCX",
        generationStatus: "GENERATED", validationStatus: "VALIDATED", reviewStatus: "APPROVED",
        fileContent: docx.toString("base64"),
        contentSha256: createHash("sha256").update(docx).digest("hex"),
        contentByteLength: docx.length,
        contentMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        detectedFormat: "DOCX", integrityStatus: "VERIFIED",
      },
    });

    // The DOCX source is itself a coherent artifact.
    assert.equal(isFinalExportCandidateDocument(source as never), true, "validated DOCX source must be eligible");

    const result = await finalizeRequiredPdf({
      requiredFileName: "Technical-Proposal.pdf",
      tender: { title: tender.title, clientName: tender.clientName },
      sourceDocument: source as never,
    });
    assert.equal(
      result.ok,
      true,
      result.ok ? "" : `${result.code}: ${result.publicMessage}`,
    );
    if (!result.ok) throw new Error("unreachable");

    const pdfBuffer = result.bytes;
    assert.ok(pdfBuffer.byteLength > 0, "the finaliser must return bytes");
    assert.equal(pdfBuffer.subarray(0, 5).toString("ascii"), "%PDF-", "converted output must be a real PDF");
    assert.equal(result.fileName, "Technical-Proposal.pdf");
    assert.equal(result.sourceDocumentId, source.id, "the PDF must be traceable to its validated DOCX source");
    const pdfBase64 = pdfBuffer.toString("base64");

    const pdfDoc = await prisma.generatedDocument.create({
      data: {
        tenderId: tender.id, name: "Technical Proposal", exactFileName: "Technical-Proposal.pdf",
        documentType: "TECHNICAL_PROPOSAL", format: "PDF",
        generationStatus: "GENERATED", validationStatus: "VALIDATED", reviewStatus: "APPROVED",
        fileContent: pdfBase64,
        contentSha256: createHash("sha256").update(pdfBuffer).digest("hex"),
        contentByteLength: pdfBuffer.length,
        contentMimeType: "application/pdf", detectedFormat: "PDF", integrityStatus: "VERIFIED",
      },
    });

    assert.equal(isFinalExportCandidateDocument(pdfDoc as never), true);
    assert.equal(deriveDocumentOutputState(pdfDoc as never), "READY_FOR_EXPORT");

    const readiness = await checkFullExportReadiness({
      tenderId: tender.id,
      docs: [pdfDoc] as never[],
      requireFileContent: true,
    });
    const pdfFailure = readiness.failures.find((f) => f.documentId === pdfDoc.id);
    assert.equal(pdfFailure, undefined, `the converted PDF must raise no readiness failure: ${JSON.stringify(pdfFailure)}`);
  } finally {
    if (tenderId) await prisma.tender.delete({ where: { id: tenderId } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }
});

test("a deliberately mismatched artifact fails closed at readiness, state and candidacy", {
  skip: !RUN,
  timeout: 120_000,
}, async () => {
  const user = await prisma.user.create({
    data: { email: `identity-bad-${randomUUID()}@test.local`, passwordHash: "unused", role: "PROPOSAL_MANAGER" },
  });
  let tenderId: string | null = null;
  try {
    const tender = await prisma.tender.create({ data: { userId: user.id, title: "Water Supply Design", status: "DRAFT" } });
    tenderId = tender.id;

    const docx = await makeDocx("Content that is genuinely DOCX. ".repeat(40));
    // EXACTLY the live shape: .pdf name, DOCX declared, DOCX bytes — and every
    // workflow status already green, which is what it used to ride on.
    const bad = await prisma.generatedDocument.create({
      data: {
        tenderId: tender.id, name: "Technical Proposal", exactFileName: "Technical Proposal.pdf",
        documentType: "TECHNICAL_PROPOSAL", format: "DOCX",
        generationStatus: "GENERATED", validationStatus: "VALIDATED", reviewStatus: "APPROVED",
        fileContent: docx.toString("base64"),
        contentSha256: createHash("sha256").update(docx).digest("hex"),
        contentByteLength: docx.length,
        contentMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        detectedFormat: "DOCX", integrityStatus: "VERIFIED",
      },
    });

    assert.equal(isFinalExportCandidateDocument(bad as never), false, "a .pdf holding DOCX bytes must never be an export candidate");
    assert.equal(deriveDocumentOutputState(bad as never), "ARTIFACT_IDENTITY_MISMATCH");

    // The auto-finalize validation pass takes requireFileContent:false while
    // holding the bytes. It must still see a NON-workflow reason, because
    // runCanonicalValidation marks a document VALIDATED when the only failures
    // are workflow ones — that is precisely how the live row got VALIDATED.
    const readiness = await checkFullExportReadiness({
      tenderId: tender.id,
      docs: [bad] as never[],
      requireFileContent: false,
    });
    const failure = readiness.failures.find((f) => f.documentId === bad.id);
    assert.ok(failure, "the mismatched artifact must fail readiness");
    const nonWorkflow = failure!.reasons.filter((r) => !/^reviewStatus is |^validationStatus is /.test(r));
    assert.ok(
      nonWorkflow.length > 0,
      `at least one reason must survive the review-workflow filter, else auto-finalize marks it VALIDATED: ${JSON.stringify(failure!.reasons)}`,
    );
    assert.ok(
      nonWorkflow.some((r) => /ARTIFACT_IDENTITY_MISMATCH|FILE_SIGNATURE_MISMATCH/.test(r)),
      `the reason must name the identity defect: ${JSON.stringify(nonWorkflow)}`,
    );

    // And it must not be usable as a PDF conversion source either.
    const conversion = await finalizeRequiredPdf({
      requiredFileName: "Technical-Proposal.pdf",
      tender: { title: tender.title },
      sourceDocument: bad as never,
    });
    assert.equal(conversion.ok, false, "a mismatched artifact must not be a conversion source");
    if (conversion.ok) throw new Error("unreachable");
    assert.equal(conversion.code, "PDF_SOURCE_NOT_ELIGIBLE");
  } finally {
    if (tenderId) await prisma.tender.delete({ where: { id: tenderId } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }
});
