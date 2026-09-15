// A proposal and its finalized PDF are the same document, so they must get the
// same answer.
//
// WHY THIS FILE EXISTS
// --------------------
// On a real owner run (tender ba7d5b20…, AUTO_FINALIZE job edc85bf3…), the
// generated Technical Proposal.docx scored 98/100 GOOD while the PDF rendered
// FROM IT scored 80/100 QUALITY_FAILED, and AUTO_FINALIZE died with
//
//   AUTO_FINALIZE_NOT_CONVERGED — … 1 tender-level blocker(s) remain:
//   GENERATED_DOCUMENT_QUALITY_FAILED
//     Technical Proposal.pdf … issueCodes ["PRICING_LEAKAGE",
//     "MISSING_TITLE_OR_COVER"]
//
// on a proposal that quotes no price and whose cover page reads "Subject:
// Technical Proposal for …". Every one of the three differences came from HOW
// the PDF's text was read, not from what the PDF says:
//
//   1. generatedDocumentVisibleText flattened all 2,155 newlines of the
//      extracted PDF into one line. The cover/title check anchors on `^…`/m,
//      so it could not see a title; pricing hygiene splits fragments on `\n`,
//      so its "a fragment ending in a number must not pair with a priced term
//      starting the next fragment" guarantee — the whole point of
//      pricing-hygiene-fragment-boundary.test.ts — silently did not apply to
//      PDFs at all.
//   2. A PDF text layer wraps a paragraph across visual lines, so an amount
//      arrived on a line of its own, severed from the label, client and years
//      that identify it as a PAST project from the Company Vault.
//   3. lib/extract-text.ts annotates a recovered table with its own
//      "[Table: N rows] / Row k:" scaffolding, and the "2" of "Row 2" paired
//      with the words "Contract Value" in the next 90 characters — inside a
//      row that states no amount and says the value is in an appendix.
//
// Nothing here relaxes a threshold or a pattern. The same detectors are given
// the text the document actually has. Each SAFE case is paired with an UNSAFE
// one in the same shape, so a genuine current-bid price still fails closed.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { containsPricingLeakage } from "../lib/engine/pricing-hygiene";
import {
  collapseWhitespace,
  collapseWhitespacePerLine,
  reflowExtractedPdfLines,
} from "../lib/engine/generated-document-text";

const TECHNICAL_DOC = {
  name: "Technical Proposal",
  exactFileName: "Technical Proposal.pdf",
  documentType: "TECHNICAL_PROPOSAL",
  format: "PDF",
} as never;

// The vault project reference as the DOCX carries it: one paragraph, with the
// costs of a PAST project enumerated 1./2./3.
const DOCX_REFERENCE_PARAGRAPH =
  "G+6 General Hospital — City Administration of Abuja / Abuja, Federal Capital Territory (7,500 m²) "
  + "Testimony letter from client 1. Construction Cost: 18,900,000 USD 2. Feasibility Study, Geotechnical "
  + "& New Design Cost: 945,000 USD 3. Contract Administration & Construction Supervision Cost: "
  + "8,700 USD/month 2024-2026 G.C. (Ongoing)";

// The same paragraph as a PDF text layer returns it: wrapped across visual
// lines, with the extractor's own table scaffolding around it.
const PDF_EXTRACTED_PAGE = [
  "[Page 7]",
  "G+6 General Hospital — City Administration of Abuja / Abuja, Federal Capital Territory (7,500 m²)",
  "Testimony letter from client 1. Construction Cost: 18,900,000 USD 2. Feasibility Study,",
  "Geotechnical & New Design Cost: 945,000 USD 3. Contract Administration & Construction Supervision Cost:",
  "8,700 USD/month 2024-2026 G.C. (Ongoing)",
  "[Table: 3 rows]",
  "Row 1: Duration | Dates on file",
  "Row 2: Contract Value | Value detail in Appendix B (project reference)",
  "Row 3: Services Provided | Architecture, Structural Engineering",
].join("\n");

// The same shapes, but quoting a price for THIS bid.
const DOCX_CURRENT_PRICE_PARAGRAPH =
  "Our consultancy fee for this assignment is 4,500,000 ETB, payable against the milestones below.";
const PDF_CURRENT_PRICE_PAGE = [
  "[Page 7]",
  "Our consultancy fee for this assignment is",
  "4,500,000 ETB, payable against the milestones below.",
  "[Table: 2 rows]",
  "Row 1: Total price | 4,500,000 ETB",
].join("\n");

describe("one proposal, one pricing verdict", () => {
  it("clears a past-project reference written as an enumerated cost list (DOCX shape)", () => {
    assert.equal(containsPricingLeakage(DOCX_REFERENCE_PARAGRAPH, TECHNICAL_DOC), false);
  });

  it("clears the same reference after PDF extraction (wrapped lines + table scaffolding)", () => {
    const asRead = reflowExtractedPdfLines(collapseWhitespacePerLine(PDF_EXTRACTED_PAGE));
    assert.equal(containsPricingLeakage(asRead, TECHNICAL_DOC), false);
  });

  it("still refuses a current-bid price in the DOCX shape", () => {
    assert.equal(containsPricingLeakage(DOCX_CURRENT_PRICE_PARAGRAPH, TECHNICAL_DOC), true);
  });

  it("still refuses a current-bid price after PDF extraction", () => {
    const asRead = reflowExtractedPdfLines(collapseWhitespacePerLine(PDF_CURRENT_PRICE_PAGE));
    assert.equal(containsPricingLeakage(asRead, TECHNICAL_DOC), true);
  });
});

describe("extracted PDF text keeps the structure the checks read", () => {
  it("collapseWhitespacePerLine keeps line boundaries; collapseWhitespace still removes them", () => {
    const raw = "[Page 1]\nSubject:   Technical Proposal\n\n\nSubmitted to: Pharo Ventures\n";
    const perLine = collapseWhitespacePerLine(raw);
    assert.ok(perLine.includes("\nSubject: Technical Proposal\n"));
    assert.equal(perLine.split("\n").length, 4);
    assert.equal(collapseWhitespace(raw).includes("\n"), false);
  });

  it("a cover line survives extraction, so the title anchor can see it", () => {
    const cover = collapseWhitespacePerLine("[Page 1]\nSubject: Technical Proposal for Pharo Ventures\nGenerated: 02 September 2026");
    assert.match(cover, /^(?:title|cover|subject|date|technical\s+proposal)\b/im);
  });

  it("reflow joins a wrapped continuation but never a heading or a table row", () => {
    const reflowed = reflowExtractedPdfLines(
      [
        "Contract Administration & Construction Supervision Cost:",
        "8,700 USD/month 2024-2026 G.C.",
        "Row 2: Contract Value | Value detail in Appendix B",
        "Understanding of the Assignment",
      ].join("\n"),
    );
    const lines = reflowed.split("\n");
    assert.equal(lines.length, 3);
    assert.ok(lines[0].includes("Supervision Cost: 8,700 USD/month"));
    assert.equal(lines[1], "Row 2: Contract Value | Value detail in Appendix B");
    assert.equal(lines[2], "Understanding of the Assignment");
  });
});
