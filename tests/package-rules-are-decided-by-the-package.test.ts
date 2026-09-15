// A requirement the PACKAGE proves is decided by the package, not the vault.
//
// Reproduced defect (live Preview, tender 08e250af, export-readiness
// 2026-09-11T12:24Z):
//
//   MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE
//   "release-qualified FULL/SUBSTANTIAL coverage for 3/6 mandatory
//    requirements ... no confirmation click can bypass this gate"
//
// and, for one of the uncovered three:
//
//   title        "Technical Proposal Document"   mandatory: true
//   displayStatus "PARTIALLY_MET"
//   packageRule  { family: "FILE_FORMAT", status: "PENDING_PACKAGE",
//                  reason: "...It is satisfied by the produced package and
//                           needs no owner-supplied evidence." }
//
// The model said in its own words that the requirement needs no owner-supplied
// evidence, and the release gate simultaneously counted it as lacking
// owner-supplied evidence. On 2026-09-10 the same contradiction sent the owner
// "Add trusted traced evidence for mandatory requirement: Email Submission
// Only" — a Company Vault document that cannot exist for a rule about how the
// bid is sent.
//
// blockerReason already knew this (final-package-readiness-model.ts) and
// refused to ask for impossible evidence. displayStatus did not, and
// displayStatus is what the release snapshot counts:
//   covered = mandatoryStatuses.filter(s => s.displayStatus === "FULLY_MET")
//
// THE POINT OF THIS TEST IS THAT THE GATE STAYS CLOSED. Nothing is covered
// because a rule left a denominator. Only an objective SATISFIED verdict from
// the package counts; every other verdict still blocks, and capability
// requirements still require source-backed evidence.
//
// Generic: submission and packaging rules exist in every tender type HAEC
// bids — EOI, RFP, road, water, urban planning, supervision, geotechnical,
// building, hospital, industrial. Nothing here keys on a sector.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { mapRequirementsToEvidence } from "../lib/engine/final-package-readiness-model";

type Req = Record<string, unknown>;

const doc = (name: string, documentType: string, format: string) => ({
  id: name,
  name,
  exactFileName: name,
  documentType,
  format,
  generationStatus: "GENERATED",
  validationStatus: "VALIDATED",
  reviewStatus: "PENDING",
  fileContent: Buffer.from("PKfake").toString("base64"),
});

/** Requirement with no linked evidence at all — the vault cannot help it. */
function requirement(over: Req): Req {
  return {
    id: "r1",
    title: "Requirement",
    description: null,
    restrictions: null,
    requirementType: null,
    priority: "MANDATORY",
    sourceExactQuote: null,
    sourcePageNumber: 1,
    sourceTenderFileId: "f1",
    complianceMatrixRows: [],
    ...over,
  };
}

function statusesFor(reqs: Req[], documents: ReturnType<typeof doc>[]) {
  return mapRequirementsToEvidence(
    reqs as never,
    [] as never,
    [] as never,
    [{ id: "f1", extractedText: "x", totalPages: 1 }] as never,
    { documents } as never,
  );
}

// Field for field as the live API returns it. The `restrictions` line matters:
// without it the clause reads as NOT_MACHINE_DECIDABLE rather than FILE_FORMAT,
// which is a different (and also correct) branch — see the guard test below.
const FORMAT_RULE = requirement({
  title: "Technical Proposal Document",
  description: "Submit one single consolidated Technical Proposal in PDF format. "
    + "This must be the main deliverable for the technical bid submission.",
  restrictions: "Submission format: PDF format required.",
  requirementType: "FILE_FORMAT",
  sourceExactQuote: "Required Documents: Technical Proposal.pdf",
});

describe("a requirement the package proves is decided by the package", () => {
  it("an OBEYED package rule counts as covered, with no owner evidence", () => {
    const [status] = statusesFor([FORMAT_RULE], [doc("Technical Proposal.pdf", "TECHNICAL_PROPOSAL", "PDF")]);
    assert.equal(status.packageRule?.status, "SATISFIED", `precondition: ${status.packageRule?.reason}`);
    assert.equal(status.displayStatus, "FULLY_MET", "an obeyed package rule must count as met");
    assert.equal(status.blockerReason, null);
    // The whole point: zero vault evidence, and still covered.
    assert.equal(status.selectedEvidenceCount, 0);
  });

  it("a BROKEN package rule is NOT_MET — the gate stays closed", () => {
    const [status] = statusesFor([FORMAT_RULE], [doc("Technical Proposal.docx", "TECHNICAL_PROPOSAL", "DOCX")]);
    assert.equal(status.packageRule?.status, "VIOLATED");
    assert.equal(status.displayStatus, "NOT_MET", "a violated rule must never read as met");
    assert.ok(status.blockerReason, "a violated rule must explain itself");
  });

  it("a rule awaiting the package is NOT counted as met", () => {
    // This is the exact live state: no package yet, so nothing is provable.
    // Fail-closed means "not yet observable" never reads as satisfied.
    const [status] = statusesFor([FORMAT_RULE], []);
    assert.equal(status.packageRule?.status, "PENDING_PACKAGE");
    assert.notEqual(status.displayStatus, "FULLY_MET", "an unobserved rule must not count as covered");
  });

  it("capability requirements are untouched and still need real evidence", () => {
    // The guard against over-reach: a qualification requirement has no
    // packageRule, so it keeps the vault-evidence path exactly as before. If
    // this ever starts passing on zero evidence, the fix has leaked.
    const capability = requirement({
      id: "r2",
      title: "Audited Financial Statements for the last 3 years",
      description: "Submit audited financial statements demonstrating annual turnover.",
      requirementType: "FINANCIAL",
    });
    const [status] = statusesFor([capability], [doc("Technical Proposal.pdf", "TECHNICAL_PROPOSAL", "PDF")]);
    assert.equal(status.packageRule, null, "a capability requirement must not acquire a package rule");
    assert.notEqual(status.displayStatus, "FULLY_MET", "zero evidence must never be FULLY_MET");
    assert.ok(status.blockerReason, "it must still ask for evidence");
  });

  it("a rule stored bytes cannot decide is never reported as met", () => {
    // Surfaced by a fixture slip while writing this file: drop the
    // restrictions line and the same clause classifies NOT_MACHINE_DECIDABLE
    // instead of FILE_FORMAT. That branch covers page limits, fonts, binding
    // and hard-copy counts — real rules no stored byte can settle. They must
    // never count as covered, in either direction.
    const undecidable = requirement({
      title: "Binding and hard copies",
      description: "Three spiral bound hard copies must be delivered, tabbed and indexed.",
      requirementType: "PACKAGING",
    });
    const [status] = statusesFor([undecidable], [doc("Technical Proposal.pdf", "TECHNICAL_PROPOSAL", "PDF")]);
    assert.equal(status.packageRule?.status, "NOT_MACHINE_DECIDABLE");
    assert.notEqual(status.displayStatus, "FULLY_MET", "an undecidable rule must never count as covered");
    assert.ok(status.blockerReason);
  });

  it("cross-sector: the mechanism is about rule shape, not subject matter", () => {
    const CASES: ReadonlyArray<[string, string, string]> = [
      ["road rehabilitation", "Bid Submission Form.pdf", "Submit the bid in PDF format."],
      ["water supply", "Technical Bid.pdf", "The technical bid shall be submitted in PDF format."],
      ["EOI consultant selection", "Expression of Interest.pdf", "The EOI must be provided in PDF format."],
      ["urban planning", "Inception Report.pdf", "Submission in PDF format is required."],
      ["geotechnical investigation", "Technical Offer.pdf", "Offers shall be submitted in PDF format."],
    ];
    for (const [sector, fileName, description] of CASES) {
      const req = requirement({
        title: `${sector} deliverable`,
        description,
        restrictions: "Submission format: PDF format required.",
        requirementType: "FILE_FORMAT",
        sourceExactQuote: `Required Documents: ${fileName}`,
      });
      const obeyed = statusesFor([req], [doc(fileName, "TECHNICAL_PROPOSAL", "PDF")])[0];
      assert.equal(obeyed.displayStatus, "FULLY_MET", `${sector}: obeyed rule must count as met`);

      const broken = statusesFor([req], [doc(fileName.replace(".pdf", ".docx"), "TECHNICAL_PROPOSAL", "DOCX")])[0];
      assert.equal(broken.displayStatus, "NOT_MET", `${sector}: broken rule must stay blocked`);
    }
  });
});
