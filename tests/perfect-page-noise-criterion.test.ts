// CLAUDE.md "perfectly extracted page" — criterion 5: the text must NOT be only
// headers/footers/noise. A page whose raw character count clears the density
// threshold but whose MEANINGFUL content (after stripping page numbers / footers
// / separators) does not, must not be counted as perfectly extracted.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { assessExtractionQualityPerPage, meaningfulPageCharCount } from "../lib/extraction-quality";

describe("perfectly-extracted page — not only headers/footers/noise (CLAUDE.md)", () => {
  it("meaningfulPageCharCount strips page numbers, footers, separators", () => {
    const noise = [
      "Page 2 of 40",
      "- 12 -",
      "1 / 40",
      "Confidential",
      "© 2026 Procurement Authority. All rights reserved.",
      "============================",
      "____________________________",
    ].join("\n");
    assert.ok(meaningfulPageCharCount(noise) < 20, "noise-only page must have near-zero meaningful content");

    const real = "The procuring entity invites sealed bids from eligible and qualified bidders for the construction of a rural health centre in accordance with the tender documents.";
    assert.ok(meaningfulPageCharCount(real) > 150, "a real content page keeps its meaningful content");
  });

  it("does NOT count a noise-dominated page (raw count above threshold) as perfect", () => {
    // ~190 raw chars, but all of it is header/footer/page-number/separator noise.
    const noisePage =
      "[Page 2]\n" +
      "Page 2 of 40\n" +
      "Confidential — Procurement Authority\n" +
      "© 2026 Procurement Authority. All rights reserved.\n" +
      "==============================================\n" +
      "1 / 40\n" +
      "- 12 -";
    const report = assessExtractionQualityPerPage(noisePage);
    assert.ok(!report.perfectPages.includes(2), "a noise-only page must NOT be perfectly extracted");
    assert.ok(report.lowDensityPages.includes(2), "a noise-only page is low-density");
  });

  it("still counts a genuine content page as perfectly extracted", () => {
    const contentPage =
      "[Page 3]\n" +
      "The procuring entity invites sealed bids from eligible and qualified bidders for the " +
      "construction of a rural health centre. Bids must be submitted by the deadline specified " +
      "in the tender documents, and all bidders must comply with the mandatory eligibility requirements.";
    const report = assessExtractionQualityPerPage(contentPage);
    assert.ok(report.perfectPages.includes(3), "a real content page must remain perfectly extracted");
  });
});
