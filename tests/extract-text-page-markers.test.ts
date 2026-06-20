// Regression test for PDF page-marker preservation.
//
// Bug: extractPdf chose the longest-text extractor, which is frequently
// pdf-parse. pdf-parse's flat `text` field has NO [Page N] markers, so a
// multi-page digital PDF reported an unknown page count downstream
// (tender-upload-first derived totalPages = null; assessExtractionQualityPerPage
// fell back to DOCUMENT_LEVEL with a single page). That blocked export
// ("page count unknown") and destroyed per-page source attribution that
// CLAUDE.md requires for every requirement / client detail.
//
// Fix: rebuild pdf-parse v2 output from its per-page result.pages array so
// [Page N] markers survive. This test drives a generated 3-page PDF through
// the real extractTextFromBuffer and asserts the markers + page detection.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractTextFromBuffer } from "../lib/extract-text";
import { assessExtractionQualityPerPage } from "../lib/extraction-quality";

async function buildThreePagePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pageBodies = [
    "REQUEST FOR PROPOSAL. Procuring Entity: Nairobi Water and Sewerage Authority. Reference RFP-2026-014. Construction Supervision Services for Bulk Water Supply. Country: Kenya.",
    "SUBMISSION INSTRUCTIONS. Proposals must be submitted by email to tenders at nairobiwater dot go dot ke no later than 30 March 2026 at 15:00. Contact person Eng. Jane Mwangi.",
    "EVALUATION CRITERIA AND REQUIRED DOCUMENTS. Technical proposal weight 80 percent, financial 20 percent. Required documents: certificate of incorporation, tax compliance, audited financial statements, curriculum vitae of the team leader.",
  ];
  for (const body of pageBodies) {
    const page = doc.addPage([595, 842]);
    let y = 800;
    for (const word of chunkWords(body, 9)) {
      page.drawText(word, { x: 40, y, size: 11, font });
      y -= 18;
    }
  }
  return Buffer.from(await doc.save());
}

function chunkWords(text: string, perLine: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  for (let i = 0; i < words.length; i += perLine) lines.push(words.slice(i, i + perLine).join(" "));
  return lines;
}

describe("extract-text — PDF page markers", () => {
  it("preserves [Page N] markers and the page count for a multi-page digital PDF", async () => {
    const pdf = await buildThreePagePdf();
    const text = await extractTextFromBuffer(pdf, "application/pdf", "rfp.pdf");

    const markerCount = (text.match(/\[Page\s+\d+\]/gi) ?? []).length;
    assert.equal(markerCount, 3, `expected 3 [Page N] markers, got ${markerCount}`);

    // Replicates the page-count derivation in lib/tender-upload-first.ts.
    const derivedTotalPages = markerCount > 0 ? markerCount : null;
    assert.equal(derivedTotalPages, 3, "derived totalPages must be 3, not null");

    // Real text must survive too — markers are additive, not a replacement.
    assert.ok(/Procuring Entity/i.test(text), "extracted text must contain the body content");
  });

  it("enables PAGE_MARKERS per-page detection (source attribution)", async () => {
    const pdf = await buildThreePagePdf();
    const text = await extractTextFromBuffer(pdf, "application/pdf", "rfp.pdf");
    const report = assessExtractionQualityPerPage(text);

    assert.equal(report.detectionMode, "PAGE_MARKERS", "must detect physical pages, not whole-document");
    assert.equal(report.totalDetectedPages, 3, "must detect 3 pages");
    // Submission instructions are on page 2; evaluation criteria on page 3.
    assert.ok(report.submissionInstructionPages.includes(2), "submission instructions should map to page 2");
    assert.ok(report.evaluationCriteriaPages.includes(3), "evaluation criteria should map to page 3");
  });
});
