// A format clause that names one deliverable governs that deliverable.
//
// Reproduced defect (live Preview, tender 08e250af, read-only inspect
// 2026-09-10). The last blocker holding the package was:
//
//   FILE_FORMAT VIOLATED — "The tender requires PDF for the technical
//   envelope, but 1 current document(s) are not PDF: Company Profile.docx
//   (DOCX)."
//
// The requirement it came from, quoted from the live API:
//
//   priority         MANDATORY   type FORMAT
//   description      "Submit one single consolidated Technical Proposal in
//                     PDF format. This must be the main deliverable for the
//                     technical bid submission."
//   sourceExactQuote "Required Documents: Technical Proposal.pdf"
//
// That clause is about the Technical Proposal. It never mentions a Company
// Profile. checkFileFormat resolved its scope with scopedEnvelope(), which
// sees the word "technical" and returns the whole TECHNICAL envelope, so a
// single-document rule was applied to every technical attachment and blocked
// the release over a file the tender never asked to be a PDF.
//
// The tender also supplies no exactFileNaming and no exactFileOrder (both
// null on this tender), so "Company Profile.docx" comes from the confirmed
// Build Plan, not from the tender text. Converting it to PDF to satisfy the
// envelope reading would have shipped the procuring entity a format they did
// not request — worse than the blocker.
//
// Named files therefore win over the envelope, EXCEPT when the clause is
// universally quantified ("all technical documents..."), which still means
// all of them. Generic: nothing here keys on a sector, a document type, or a
// particular tender.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { evaluatePackageConformance, classifyPackageRule } from "../lib/engine/package-conformance";

type Doc = {
  id: string;
  name: string;
  exactFileName: string;
  documentType: string;
  format: string;
  generationStatus?: string;
  validationStatus?: string;
  reviewStatus?: string;
  fileContent?: string | null;
};

const bytes = Buffer.from("PKfake").toString("base64");
const doc = (name: string, documentType: string, format: string): Doc => ({
  id: name,
  name,
  exactFileName: name,
  documentType,
  format,
  generationStatus: "GENERATED",
  validationStatus: "VALIDATED",
  reviewStatus: "PENDING",
  fileContent: bytes,
});

/** The live requirement, field for field. */
const NAMED_ONE = {
  title: "Technical Proposal Document",
  description:
    "Submit one single consolidated Technical Proposal in PDF format. "
    + "This must be the main deliverable for the technical bid submission.",
  restrictions: "Submission format: PDF format required.",
  requirementType: "FILE_FORMAT",
  exactFileName: null,
  sourceExactQuote: "Required Documents: Technical Proposal.pdf",
};

const PACKAGE = [
  doc("Technical Proposal.pdf", "TECHNICAL_PROPOSAL", "PDF"),
  doc("Company Profile.docx", "COMPANY_PROFILE", "DOCX"),
];

function verdictFor(requirement: unknown, documents: Doc[]) {
  return evaluatePackageConformance(
    requirement as Parameters<typeof evaluatePackageConformance>[0],
    { documents } as unknown as Parameters<typeof evaluatePackageConformance>[1],
  );
}

describe("a format clause governs the documents it names", () => {
  it("classifies as a FILE_FORMAT package rule at all", () => {
    // Guard the premise: if this stops classifying, the assertions below
    // would pass vacuously.
    assert.equal(classifyPackageRule(NAMED_ONE as never), "FILE_FORMAT");
  });

  it("the reproduced case no longer blocks on an unnamed sibling", () => {
    const v = verdictFor(NAMED_ONE, PACKAGE);
    assert.notEqual(v.status, "VIOLATED", `still blocking: ${v.reason}`);
    assert.doesNotMatch(v.reason, /Company Profile/, "a clause about the Technical Proposal must not cite Company Profile");
  });

  it("the named document in the wrong format still VIOLATES", () => {
    // The whole point of the rule survives: narrowing scope must not make it
    // toothless for the document it actually governs.
    const v = verdictFor(NAMED_ONE, [
      doc("Technical Proposal.docx", "TECHNICAL_PROPOSAL", "DOCX"),
      doc("Company Profile.docx", "COMPANY_PROFILE", "DOCX"),
    ]);
    assert.equal(v.status, "VIOLATED", "the named deliverable must still be checked");
    assert.match(v.reason, /Technical Proposal/);
  });

  it("a universally quantified clause still covers the whole envelope", () => {
    for (const phrase of [
      "All technical documents must be submitted in PDF format.",
      "Every document in the technical submission shall be in PDF format.",
      "The entire submission must be provided in PDF format without exception.",
    ]) {
      const v = verdictFor({ ...NAMED_ONE, description: phrase, sourceExactQuote: phrase }, PACKAGE);
      assert.equal(v.status, "VIOLATED", `universal clause stopped covering the envelope: ${phrase}`);
      assert.match(v.reason, /Company Profile/, `universal clause must still cite the offending file: ${phrase}`);
    }
  });

  it("a clause naming no file keeps the envelope reading", () => {
    const v = verdictFor(
      { ...NAMED_ONE, description: "Technical submissions must be in PDF format.", sourceExactQuote: null },
      PACKAGE,
    );
    assert.equal(v.status, "VIOLATED", "with nothing named, the envelope scope must still apply");
  });

  it("a named file absent from the package does not silently pass", () => {
    // Scoping to a document that is not there would govern nothing and read
    // as SATISFIED — a rule matching no document must not look obeyed.
    const v = verdictFor(
      { ...NAMED_ONE, sourceExactQuote: "Required Documents: Some Other Form.pdf" },
      PACKAGE,
    );
    assert.notEqual(v.status, "SATISFIED", "an unmatched named file must fall back, not vacuously pass");
  });

  it("every caller actually passes the tender's exact quote", () => {
    // This test exists because the fix shipped INERT without it.
    //
    // formatRuleScope() reads file names from the requirement, and on this
    // tender the file name appears ONLY in sourceExactQuote ("Required
    // Documents: Technical Proposal.pdf") — the description says merely "in
    // PDF format". The unit tests above passed because they construct the
    // requirement themselves and supply the field. Production callers built
    // a literal object without it, so namedFilesIn() found nothing, the
    // envelope scope was kept, and the live verdict stayed VIOLATED:
    //
    //   "packageRule": { "family": "FILE_FORMAT", "status": "VIOLATED",
    //     "reason": "...not PDF: Company Profile.docx (DOCX)." }
    //
    // A function fixed but not fed is not a fix. Assert the wiring.
    const callers = [
      "lib/engine/final-package-readiness-model.ts",
      "app/api/tenders/[id]/requirement-coverage/route.ts",
      "lib/engine/automatic-requirement-coverage.ts",
    ];
    for (const file of callers) {
      const src = readFileSync(file, "utf8");
      const at = src.indexOf("evaluatePackageConformance(");
      assert.ok(at > -1, `${file} no longer calls evaluatePackageConformance`);
      const call = src.slice(at, at + 900);
      // Either the whole requirement is forwarded, or the quote is named.
      const forwardsWholeRequirement = /evaluatePackageConformance\(\s*requirement\s*,/.test(call);
      assert.ok(
        forwardsWholeRequirement || /sourceExactQuote/.test(call),
        `${file} builds a requirement for evaluatePackageConformance without sourceExactQuote`,
      );
    }
  });

  it("says which file it judged, without calling that file a container", () => {
    // Live verdict on tender 08e250af after the scope fix landed:
    //
    //   "Every current export-candidate document in the Technical Proposal.pdf
    //    is PDF, so the format rule is obeyed by construction."
    //
    // The verdict was right and the sentence was wrong. Reusing the envelope
    // phrasing for a named file tells the owner a document sits "in" another
    // document, which reads as though the rule covers a container. These
    // messages are what an owner sees when a release is held or cleared, so
    // the shape of the sentence is part of the deliverable.
    const v = verdictFor(NAMED_ONE, PACKAGE);
    assert.equal(v.status, "SATISFIED");
    assert.doesNotMatch(
      v.reason,
      /in the Technical Proposal\.pdf/,
      `a named file is not a place documents sit in: ${v.reason}`,
    );
    assert.match(v.reason, /Technical Proposal\.pdf/, "the judged file must still be named");
    assert.match(v.reason, /no other/i, "narrowed scope must be stated, not left implicit");

    // The envelope reading keeps its own phrasing.
    const envelope = verdictFor(
      { ...NAMED_ONE, description: "All technical documents must be submitted in PDF format.", sourceExactQuote: null },
      [doc("Technical Proposal.pdf", "TECHNICAL_PROPOSAL", "PDF")],
    );
    assert.equal(envelope.status, "SATISFIED");
    assert.match(envelope.reason, /technical envelope/);
  });

  it("a violation names the file the rule governs, not the envelope", () => {
    const v = verdictFor(NAMED_ONE, [
      doc("Technical Proposal.docx", "TECHNICAL_PROPOSAL", "DOCX"),
    ]);
    assert.equal(v.status, "VIOLATED");
    assert.doesNotMatch(
      v.reason,
      /for the technical envelope/,
      `a rule narrowed to one file must not report itself as an envelope rule: ${v.reason}`,
    );
  });

  // Cross-sector: the mechanism is about clause shape, not subject matter.
  const CROSS_SECTOR: ReadonlyArray<[string, string, Doc[]]> = [
    ["road rehabilitation", "Required Documents: Bid Submission Form.pdf",
      [doc("Bid Submission Form.pdf", "BID_FORM", "PDF"), doc("Bill of Quantities.xlsx", "FINANCIAL_PROPOSAL", "XLSX")]],
    ["water supply", "Required Documents: Technical Bid.pdf",
      [doc("Technical Bid.pdf", "TECHNICAL_PROPOSAL", "PDF"), doc("Method Statement.docx", "TECHNICAL_PROPOSAL", "DOCX")]],
    ["EOI consultant selection", "Required Documents: Expression of Interest.pdf",
      [doc("Expression of Interest.pdf", "TECHNICAL_PROPOSAL", "PDF"), doc("Firm Profile.docx", "COMPANY_PROFILE", "DOCX")]],
  ];
  for (const [sector, quote, pkg] of CROSS_SECTOR) {
    it(`${sector}: an unnamed sibling in another format does not block`, () => {
      const v = verdictFor({ ...NAMED_ONE, sourceExactQuote: quote }, pkg);
      assert.notEqual(v.status, "VIOLATED", `${sector} blocked: ${v.reason}`);
    });
  }
});
