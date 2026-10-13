// Release surfaces must judge the same bytes, and the final deliverable is a PDF.
//
// THE CONTRADICTION THIS PINS
// ---------------------------
// On hosted run 33987922811 the same artifact produced two incompatible
// verdicts at the same moment:
//
//   export-readiness:            ok, READY, zero blockers, ZIP exported
//   generated-proposals/audit:   qualityScore 0, DRAFT_ONLY,
//                                readyForExport false, zipEligible false
//
// Not a threshold disagreement — the audit had never read the document. Its
// text reader was extractDocxVisibleText, whose maybeBase64Docx() guard
// returns null for anything that is not an OPC package. The final artifact of
// a completed run is a PDF, so the audit saw nothing, quality came back null,
// and the score defaulted to 0 with status DRAFT_ONLY. Meanwhile
// export-readiness reads PDFs through generatedDocumentVisibleText and
// correctly reported READY.
//
// The fix is that both surfaces read through the one canonical reader. It is
// NOT that the audit trusts metadata or assumes a pass: the second test below
// pins that a genuinely thin PDF still fails, so the contradiction is resolved
// by making the audit see, not by making it agree.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { extractDocxVisibleText } from "../lib/engine/export-readiness";
import { generatedDocumentVisibleText } from "../lib/engine/generated-document-text";
import { assessGeneratedDocumentQuality } from "../lib/engine/document-quality-gate";

async function buildPdf(lines: string[]): Promise<string> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let page = doc.addPage([595, 842]);
  let y = 780;
  for (const line of lines) {
    if (y < 60) {
      page = doc.addPage([595, 842]);
      y = 780;
    }
    page.drawText(line.slice(0, 95), { x: 50, y, size: 10, font });
    y -= 16;
  }
  return Buffer.from(await doc.save()).toString("base64");
}

const PDF_DOC_META = {
  name: "Technical Proposal",
  exactFileName: "Technical Proposal.pdf",
  documentType: "TECHNICAL_PROPOSAL",
  format: "PDF",
} as const;

describe("the generated-proposal audit reads the final PDF, not just DOCX", () => {
  it("recovers visible text from PDF bytes that the DOCX-only reader cannot see", async () => {
    const base64 = await buildPdf([
      "Technical Proposal for Pharo Ventures",
      "Section C: Technical Approach and Methodology",
      "Infection prevention and control zoning is coordinated with the",
      "biomedical equipment schedule before detailed design begins.",
    ]);

    // The old reader is still correct about what it claims to do; it simply
    // cannot answer the question the audit was asking it.
    assert.equal(
      await extractDocxVisibleText(base64, "Technical Proposal.pdf"),
      null,
      "the DOCX reader returns null for a PDF — this is why the audit scored 0",
    );

    const visibleText = await generatedDocumentVisibleText({
      fileContent: base64,
      exactFileName: "Technical Proposal.pdf",
      name: "Technical Proposal",
      contentMimeType: null,
    });

    assert.ok(visibleText, "the canonical reader must open PDF bytes");
    assert.match(visibleText, /Pharo Ventures/);
    assert.match(visibleText, /Technical Approach and Methodology/);
  });

  it("still fails a thin PDF — seeing the document is not the same as passing it", async () => {
    const thin = await buildPdf(["Technical Proposal", "TBD"]);
    const visibleText = await generatedDocumentVisibleText({
      fileContent: thin,
      exactFileName: "Technical Proposal.pdf",
      name: "Technical Proposal",
      contentMimeType: null,
    });
    assert.ok(visibleText, "the reader opens it");

    const quality = assessGeneratedDocumentQuality({
      doc: PDF_DOC_META as never,
      visibleText,
      rawFileContent: thin,
      hasStoragePath: false,
    });

    assert.ok(quality.score < 60, `a two-line PDF must not pass quality (got ${quality.score})`);
    assert.notEqual(quality.recommendedStatus, "PASSED");
  });

  it("keeps both audit surfaces on the one canonical reader", () => {
    // A future edit that reintroduces the DOCX-only reader on either surface
    // silently restores the contradiction, because a PDF simply reads as
    // "no text" rather than as an error.
    for (const path of [
      "app/api/admin/generated-proposals/audit/route.ts",
      "lib/engine/storage-backed-document-audit.ts",
    ]) {
      const source = readFileSync(path, "utf8");
      assert.match(
        source,
        /generatedDocumentVisibleText/,
        `${path} must read artifact text through the canonical reader`,
      );
      assert.doesNotMatch(
        source.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n"),
        /\bextractDocxVisibleText\s*\(/,
        `${path} must not read the final artifact with the DOCX-only reader`,
      );
    }
  });
});

// The second half of the same contradiction, found on hosted run 33993906509.
//
// After the reader fix above, the audit could finally see the artifact and
// scored it honestly — 88/100, PASSED, visibleTextInspectable true. It still
// reported readyForExport=false and zipEligible=false, with the reason
// "Complete validation + reviewer approval", while export-readiness reported
// ok / READY / zero blockers for the same bytes at the same moment.
//
// The audit was the only surface that required a reviewer approval status on
// top of the canonical resolver. The automatic pipeline is forbidden from
// writing it: auto-finalize-continuation-service.ts states "Per Gap 1,
// automation does not write reviewStatus=READY_FOR_EXPORT; per Gap 5,
// VALIDATED is sufficient for the automatic PDF path", and
// OWNER_AUTOMATION_CONTRACT.md lists ZIP export among the stages that run
// "automatically through durable workers with no additional routine approvals
// or buttons". So the audit's extra conjunct could never be satisfied on the
// normal path, and every automatically produced deliverable was reported as
// blocked by the audit and shipped by the export route.
describe("the audit agrees with the canonical resolver about export eligibility", () => {
  it("does not require a reviewer approval status the automatic path never writes", () => {
    const source = readFileSync("app/api/admin/generated-proposals/audit/route.ts", "utf8");
    const code = source.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");

    assert.doesNotMatch(
      code,
      /\bisReviewReadyForExport\s*\(/,
      "the audit must not gate export eligibility on a reviewStatus the automatic path cannot set",
    );
    assert.match(
      code,
      /readyForExport\s*=[^;]*deriveDocumentOutputState[\s\S]{0,200}?"READY_FOR_EXPORT"|state\s*===\s*"READY_FOR_EXPORT"/,
      "the audit must decide export eligibility from the canonical resolver",
    );
  });

  it("still refuses a document the canonical resolver does not call ready", () => {
    // Removing the approval conjunct must not make the audit permissive: the
    // resolver's own conditions still have to hold.
    const { deriveDocumentOutputState } = require("../lib/engine/document-output-state");

    const validatedPdf = {
      ...PDF_DOC_META,
      generationStatus: "GENERATED",
      validationStatus: "VALIDATED",
      reviewStatus: "PENDING",
      storagePath: "tenders/x/Technical Proposal.pdf",
      fileContent: null,
    };
    assert.equal(
      deriveDocumentOutputState(validatedPdf),
      "READY_FOR_EXPORT",
      "a validated, finalized PDF is ready even though reviewStatus is still PENDING",
    );

    // Same row, but validation has not passed.
    assert.notEqual(
      deriveDocumentOutputState({ ...validatedPdf, validationStatus: "PENDING" }),
      "READY_FOR_EXPORT",
      "without validation the resolver must not report ready",
    );
    // Same row, but the quality gate blocked it.
    assert.equal(
      deriveDocumentOutputState({ ...validatedPdf, qualityBlocked: true }),
      "QUALITY_BLOCKED",
      "a quality-blocked document must never read as ready",
    );
    // Same row, but a revalidation was demanded.
    assert.equal(
      deriveDocumentOutputState({ ...validatedPdf, validationStatus: "NEEDS_REVALIDATION" }),
      "NEEDS_REVALIDATION",
      "a row awaiting revalidation must never read as ready",
    );
  });
});

// The audit must also judge on the same INPUTS as the gate that validated the
// document, not merely read the same bytes.
//
// On hosted run 33993906509 the final PDF scored 88/100 with exactly one
// issue: MISSING_EVIDENCE_REFERENCE, "Document does not reference any selected
// reviewed expert or project". countEvidenceReferences(text, names) returns 0
// both when a document cites none of the selected evidence AND when it was
// handed no names to look for — the ambiguity current-document-quality.ts
// documents at length. The audit route called the rubric without
// selectedExpertNames/selectedProjectNames, so the issue fired against every
// technical proposal unconditionally, while validate.ts scored the same
// document with the names and did not raise it.
describe("the audit scores evidence citation on the same input as validation", () => {
  it("does not raise MISSING_EVIDENCE_REFERENCE when the document cites the selected evidence", async () => {
    const { assessGeneratedDocumentQuality: assess } = await import("../lib/engine/document-quality-gate");
    const visibleText = [
      "Technical Proposal for Pharo Ventures",
      "Section D: Team",
      "Dr Almaz Bekele leads the healthcare planning workstream for this assignment.",
      "Our comparable assignment, Hawassa Referral Hospital, is described in Section E.",
      "Section E: Comparable Experience",
      "Hawassa Referral Hospital — architectural consultancy, completed to handover.",
    ].join("\n");
    const evidence = {
      selectedExpertNames: ["Dr Almaz Bekele"],
      selectedProjectNames: ["Hawassa Referral Hospital"],
    };

    const withNames = assess({
      doc: PDF_DOC_META as never,
      visibleText,
      rawFileContent: null,
      hasStoragePath: false,
      ...evidence,
    });
    const withoutNames = assess({
      doc: PDF_DOC_META as never,
      visibleText,
      rawFileContent: null,
      hasStoragePath: false,
    });

    const codes = (report: { issues: Array<{ code: string }> }) => report.issues.map((issue) => issue.code);
    assert.ok(
      !codes(withNames).includes("MISSING_EVIDENCE_REFERENCE"),
      `citing the selected evidence must satisfy the check (issues: ${codes(withNames).join(", ")})`,
    );
    assert.ok(
      codes(withoutNames).includes("MISSING_EVIDENCE_REFERENCE"),
      "without the names the rubric cannot tell — this is the input the audit used to omit",
    );
  });

  it("still raises it when the document cites none of the selected evidence", async () => {
    // Supplying the names must not turn the check off: a proposal that names
    // nobody from the reviewed vault still has to be flagged.
    const { assessGeneratedDocumentQuality: assess } = await import("../lib/engine/document-quality-gate");
    const report = assess({
      doc: PDF_DOC_META as never,
      visibleText: "Technical Proposal for Pharo Ventures\nOur team is highly experienced.",
      rawFileContent: null,
      hasStoragePath: false,
      selectedExpertNames: ["Dr Almaz Bekele"],
      selectedProjectNames: ["Hawassa Referral Hospital"],
    });
    assert.ok(
      report.issues.map((issue) => issue.code).includes("MISSING_EVIDENCE_REFERENCE"),
      "a document citing none of the reviewed evidence must still be flagged",
    );
  });

  it("passes the selected evidence names from the audit route", () => {
    const source = readFileSync("app/api/admin/generated-proposals/audit/route.ts", "utf8");
    assert.match(source, /selectedExpertNames/, "the audit route must gather selected expert names");
    assert.match(source, /selectedProjectNames/, "the audit route must gather selected project names");
    assert.match(
      source,
      /isSelected:\s*true/,
      "only reviewer-selected matches count as the tender's chosen evidence",
    );
  });
});
