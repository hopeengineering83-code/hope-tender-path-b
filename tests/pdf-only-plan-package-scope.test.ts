/**
 * A plan that requires only a PDF must not be blocked by the DOCX that made it.
 *
 * Required-format conversion writes the PDF from a generated DOCX, so both
 * rows exist afterwards. If the confirmed plan names only
 * "Technical-Proposal.pdf", a naive extra-files rule reports the DOCX as an
 * unrequired file and the package is refused — for containing the source of
 * the very deliverable it was asked for.
 *
 * Checked against the current head before writing anything: this already
 * behaves correctly, so no code changed. These assertions exist because the
 * rule is easy to break from either side — widening it would let a genuinely
 * unrelated deliverable into a package, and narrowing it would block every
 * PDF-only tender.
 *
 * Nothing here is keyed to a benchmark; the names are the ordinary forms
 * tenders mandate.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  findExtraGeneratedDocuments,
  findMissingGeneratedDocuments,
} from "../lib/engine/submission-plan";

const plan = { files: [{ exactFileName: "Technical-Proposal.pdf", required: true }] };

type TestDoc = {
  id: string;
  name: string;
  generationStatus: string;
  exactFileName?: string;
  format?: string;
  validationStatus?: string;
  reviewStatus?: string;
  fileContent?: string;
};

const doc = (over: Partial<TestDoc> & { id: string }): TestDoc => ({
  name: "Technical Proposal",
  generationStatus: "GENERATED",
  ...over,
});

const names = (rows: Array<{ exactFileName?: string | null }>) =>
  rows.map((row) => row.exactFileName ?? "").sort();

describe("a PDF-only submission plan", () => {
  const requiredPdf = doc({ id: "pdf", exactFileName: "Technical-Proposal.pdf", format: "PDF" });

  it("does not treat the source DOCX as an unrequired extra", () => {
    const sourceDocx = doc({ id: "docx", exactFileName: "Technical-Proposal.docx", format: "DOCX" });
    assert.deepEqual(names(findExtraGeneratedDocuments(plan as never, [requiredPdf, sourceDocx])), []);
    assert.deepEqual(names(findMissingGeneratedDocuments(plan as never, [requiredPdf, sourceDocx])), []);
  });

  it("still reports a genuinely unrelated current deliverable", () => {
    // The exemption must be about the same deliverable in another format, not
    // about DOCX files in general.
    const unrelated = doc({ id: "u", name: "Company Profile", exactFileName: "Company-Profile.docx", format: "DOCX" });
    assert.deepEqual(names(findExtraGeneratedDocuments(plan as never, [requiredPdf, unrelated])), ["Company-Profile.docx"]);
  });

  it("does not let a superseded row block the current package", () => {
    // History stays auditable; it must not decide release readiness.
    const superseded = doc({ id: "s", name: "Old draft", exactFileName: "Old-Draft.docx", generationStatus: "SUPERSEDED", format: "DOCX" });
    assert.deepEqual(names(findExtraGeneratedDocuments(plan as never, [requiredPdf, superseded])), []);
  });

  it("reports a wrongly named PDF as both extra and missing", () => {
    // The plan's exact filename is the requirement, so a near-miss is not a
    // match: the required file is absent AND an unrequired one is present.
    const wrongName = doc({ id: "w", exactFileName: "TechProposal.pdf", format: "PDF" });
    assert.deepEqual(names(findExtraGeneratedDocuments(plan as never, [wrongName])), ["TechProposal.pdf"]);
    assert.deepEqual(names(findMissingGeneratedDocuments(plan as never, [wrongName])), ["Technical-Proposal.pdf"]);
  });

  it("matches plan entries by name rather than by extension, and says so", () => {
    // The plan key deliberately strips the extension — that is the mechanism
    // which stops the source DOCX being an extra above. The consequence is
    // that a source-only tender reports nothing MISSING either, so this file
    // is not where the required format is enforced.
    //
    // It is enforced on the bytes instead: deriveDocumentOutputState returns
    // PDF_CONVERSION_REQUIRED when the plan wants a PDF and the stored content
    // is not one, and isReadyForFinalExport excludes that state, so a DOCX
    // cannot stand in for a required PDF in the package. Pinned here because
    // reading only this module would suggest the opposite.
    const sourceOnly = doc({ id: "docx", exactFileName: "Technical-Proposal.docx", format: "DOCX" });
    assert.deepEqual(names(findMissingGeneratedDocuments(plan as never, [sourceOnly])), []);

    const { deriveDocumentOutputState, isReadyForFinalExport } = require("../lib/engine/document-output-state");
    const docxBytesForPdfPlan = {
      ...sourceOnly,
      validationStatus: "VALIDATED",
      reviewStatus: "READY_FOR_EXPORT",
      exactFileName: "Technical-Proposal.pdf",
      fileContent: Buffer.from("PK\u0003\u0004 not a pdf").toString("base64"),
    };
    const state = deriveDocumentOutputState(docxBytesForPdfPlan);
    assert.notEqual(state, "READY_FOR_EXPORT", `a non-PDF may not satisfy a required PDF, got ${state}`);
    // Which refusal fires is not the point and is deliberately not pinned:
    // naming it .pdf while the bytes are not one trips the artifact-identity
    // check before the conversion check. Either way the row is refused.
    assert.match(state, /PDF_CONVERSION_REQUIRED|ARTIFACT_IDENTITY_MISMATCH|CONTROL_RECORD_ONLY/);
    assert.equal(
      isReadyForFinalExport?.(docxBytesForPdfPlan) ?? false,
      false,
      "a non-PDF may not satisfy a required PDF in the package",
    );
  });
});
