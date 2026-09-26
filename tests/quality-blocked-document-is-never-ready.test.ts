import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { prisma, prismaReady } from "../lib/prisma";
import { generateProposalPdf } from "../lib/engine/proposal-pdf";
import { deriveDocumentOutputState, exportBlockReason, isExportReady } from "../lib/engine/document-output-state";
import { getFinalPackageReadinessModel } from "../lib/engine/final-package-readiness-model";
import { resolveCurrentDocumentVerdicts, selectCurrentDocuments } from "../lib/engine/current-document-quality";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

// ─── What this file proves ───────────────────────────────────────────────────
//
// The owner's Preview showed, for one tender at one moment:
//
//   Document Validator      Technical Proposal.pdf — BLOCKED, 68/100
//   Final Package Manifest  Technical Proposal.pdf — Ready, In ZIP, Blocked 0
//
// Reproduced here on ONE snapshot, ONE revision, ONE document, so it is not
// stale cross-revision state: the validator scored a real generated
// Technical Proposal.pdf "BLOCKED (14/100) QUALITY_FAILED" while the package
// model reported it READY_FOR_EXPORT, exportReady, with no blocker.
//
// The cause was that the two surfaces answer the same question from different
// authorities. Everything the package model read from a document row is
// metadata — statuses, format, byte identity — and none of it can tell whether
// the document the client receives actually says anything.
//
// The rule this pins: within one release snapshot, a quality-blocked current
// document can never be represented as final Ready or In-ZIP.

describe("a quality-blocked document cannot be reported ready for export", () => {
  let userId: string;
  let tenderId: string;

  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await prisma.user.create({
      data: { email: `quality-ready-${nonce}@example.test`, name: "Quality Ready Test", passwordHash: "test-hash", role: "ADMIN" },
    });
    userId = user.id;
    await prisma.company.create({ data: { userId, name: `Quality Ready Firm ${nonce}` } });
    const tender = await prisma.tender.create({ data: { userId, title: `Quality ready tender ${nonce}`, status: "ANALYZED" } });
    tenderId = tender.id;
    await prisma.tenderRequirement.create({
      data: { tenderId, title: "Technical methodology", description: "Provide a technical methodology.", requirementType: "TECHNICAL", priority: "MANDATORY" },
    });

    // A real PDF whose narrative is far too thin to pass the rubric, stored
    // with the columns the manifest was rendering from: validated, generated,
    // ready for export.
    const bytes = Buffer.from(await generateProposalPdf({
      title: "Technical Proposal",
      clientName: "A Client",
      markdown: "# Technical Proposal\n\nWe will do the work.\n",
      companyName: "A Firm",
    }));
    const digest = createHash("sha256").update(bytes).digest("hex");
    await prisma.generatedDocument.create({
      data: {
        tenderId, name: "Technical Proposal.pdf", documentType: "TECHNICAL_PROPOSAL", format: "PDF",
        exactFileName: "Technical Proposal.pdf", fileContent: bytes.toString("base64"),
        contentSha256: digest, contentByteLength: bytes.length, contentMimeType: "application/pdf",
        detectedFormat: "PDF", integrityStatus: "VERIFIED", integrityVerifiedAt: new Date(),
        sha256: digest, byteSize: bytes.length,
        validationStatus: "VALIDATED", generationStatus: "GENERATED", reviewStatus: "READY_FOR_EXPORT",
      },
    });
  });

  after(async () => {
    // Delete the tender itself and let the cascade take its requirements: a
    // database trigger refuses to remove the canonical requirement set on its
    // own without a staged analysis, which is the fail-closed behaviour the
    // app relies on.
    await prisma.generatedDocument.deleteMany({ where: { tenderId } });
    await prisma.tender.deleteMany({ where: { id: tenderId } });
    await prisma.company.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("the validator calls this document blocked", async () => {
    const docs = await prisma.generatedDocument.findMany({ where: { tenderId } });
    const verdicts = await resolveCurrentDocumentVerdicts(selectCurrentDocuments(docs as never) as never, []);
    assert.equal(verdicts.length, 1, "the document is not being treated as current");
    assert.equal(verdicts[0].score, "BLOCKED", `expected a blocked verdict, got ${verdicts[0].score} (${verdicts[0].report.score}/100)`);
  });

  it("the package model does not call the same document ready", async () => {
    const model = await getFinalPackageReadinessModel(prisma, tenderId, userId);
    const row = model.documents.generated.find((doc) => doc.finalFileName === "Technical Proposal.pdf");
    assert.ok(row, "the document is missing from the package model");
    assert.equal(row.outputState, "QUALITY_BLOCKED", `manifest state was ${row.outputState}`);
    assert.equal(row.exportReady, false, "a quality-blocked document was reported ready for export");
    assert.equal(row.exportCandidate, false, "a quality-blocked document was reported as an export candidate");
    assert.ok(row.blockerReason && row.blockerReason.length > 0, "no blocker reason was given for a blocked document");
  });

  it("keeps it out of the ZIP manifest", async () => {
    const model = await getFinalPackageReadinessModel(prisma, tenderId, userId);
    const inZip = model.export.manifest.files
      .filter((file) => file.exportReady)
      .map((file) => file.finalFileName);
    assert.ok(!inZip.includes("Technical Proposal.pdf"), `a quality-blocked document was listed in the ZIP: ${JSON.stringify(inZip)}`);
  });
});

describe("the derived output state understands a quality verdict", () => {
  const readyRow = {
    id: "doc-1",
    name: "Technical Proposal.pdf",
    exactFileName: "Technical Proposal.pdf",
    documentType: "TECHNICAL_PROPOSAL",
    format: "PDF",
    hasInlineFileContent: true,
    generationStatus: "GENERATED",
    validationStatus: "VALIDATED",
    reviewStatus: "READY_FOR_EXPORT",
    contentMimeType: "application/pdf",
    detectedFormat: "PDF",
  };

  it("still reports a clean document ready", () => {
    assert.equal(deriveDocumentOutputState(readyRow as never), "READY_FOR_EXPORT");
    assert.equal(isExportReady(readyRow as never), true);
  });

  it("reports a quality-blocked document blocked, whatever its stored statuses say", () => {
    const blocked = { ...readyRow, qualityBlocked: true };
    assert.equal(deriveDocumentOutputState(blocked as never), "QUALITY_BLOCKED");
    assert.equal(isExportReady(blocked as never), false);
    assert.match(exportBlockReason("QUALITY_BLOCKED") ?? "", /quality/i);
  });

  it("does not let a quality verdict mask a mislabelled artifact", () => {
    // A file that is not what it claims is the worse problem and must keep its
    // own, more specific state.
    const mislabelled = { ...readyRow, qualityBlocked: true, detectedFormat: "DOCX" };
    assert.equal(deriveDocumentOutputState(mislabelled as never), "ARTIFACT_IDENTITY_MISMATCH");
  });

  it("leaves callers that pass no verdict exactly as they were", () => {
    assert.equal(deriveDocumentOutputState({ ...readyRow, qualityBlocked: undefined } as never), "READY_FOR_EXPORT");
    assert.equal(deriveDocumentOutputState({ ...readyRow, qualityBlocked: false } as never), "READY_FOR_EXPORT");
  });
});

// ─── A planned row has no artifact to be inconsistent with ───────────────────
//
// generateMissingPlanFiles creates a still-PLANNED row for a required file it
// cannot yet produce — "Technical Proposal.pdf" awaiting PDF finalization —
// with fileContent null. It declared the format of the interim body (DOCX)
// rather than the format its own file name promises, so the row contradicted
// itself before it held a single byte, and every surface comparing name against
// declared format reported ARTIFACT_IDENTITY_MISMATCH: "a .pdf that does not
// contain PDF bytes will not open for the evaluator" — a corrupted file that
// does not exist, which is what sent the owner looking for one.

import { plannedRowFormat } from "../lib/engine/missing-plan-file-generation";

describe("a planned row is not reported as a mislabelled artifact", () => {
  const plannedPdf = {
    id: "planned-1",
    name: "Technical Proposal",
    exactFileName: "Technical Proposal.pdf",
    documentType: "TECHNICAL_PROPOSAL",
    format: "DOCX",
    fileContent: null,
    storagePath: null,
    generationStatus: "PLANNED",
    validationStatus: "PENDING",
    reviewStatus: "PENDING",
  };

  it("reports a byte-less planned row as awaiting content, not as a corrupted file", () => {
    assert.equal(deriveDocumentOutputState(plannedPdf as never), "CONTROL_RECORD_ONLY");
  });

  it("still reports a mislabelled artifact once the row actually carries bytes", () => {
    // The narrowing must not become an escape hatch: a row with content is
    // judged exactly as before.
    const withBytes = { ...plannedPdf, generationStatus: "GENERATED", hasInlineFileContent: true, fileContent: "UEsDBAo=" };
    assert.equal(deriveDocumentOutputState(withBytes as never), "ARTIFACT_IDENTITY_MISMATCH");
  });

  it("declares the format the planned file name promises", () => {
    assert.equal(plannedRowFormat("Technical Proposal.pdf", "DOCX"), "PDF");
    assert.equal(plannedRowFormat("Company Profile.docx", "DOCX"), "DOCX");
    // Control rows are records, not files, and keep their own format.
    assert.equal(plannedRowFormat("Submission Rules.pdf", "CONTROL"), "CONTROL");
    // An unknown extension leaves the decision where it was.
    assert.equal(plannedRowFormat("Annex", "DOCX"), "DOCX");
  });
});
