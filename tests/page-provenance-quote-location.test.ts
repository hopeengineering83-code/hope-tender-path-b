/**
 * Behavioral tests for locateQuoteProvenPage — THE canonical quote→page
 * resolver used by AI Analyze (streaming + non-streaming) and the durable
 * worker to guard AI-claimed page numbers.
 *
 * PR #936 invariants proven here:
 *   - No first-N-character prefix ever proves a page for a full quote.
 *   - A normalized-string offset is never used as an original-text offset.
 *   - An unfound quote yields null — never an offset-0 fallback (which would
 *     invent page 1 in a form-feed/marker document).
 *   - Duplicate quote across pages (ambiguous) → null / ungrounded.
 *   - Duplicate prefix across pages → full-quote match wins (unambiguous).
 *   - Boundaryless multi-page text cannot receive page-1 evidence.
 *   - Boundaryless totalPages=1 text may receive page 1.
 *   - Page beyond stored totalPages → null.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { locateQuoteProvenPage, computeProvenPageNumber } from "../lib/engine/page-provenance";

describe("locateQuoteProvenPage — found quotes resolve to their real page", () => {
  it("resolves a quote on page 2 via [Page N] markers", () => {
    const text = "[Page 1]\nIntroduction text here.\n[Page 2]\nThe submission deadline is 30 December 2026.\n[Page 3]\nAnnexes.";
    assert.equal(locateQuoteProvenPage(text, "submission deadline is 30 December 2026", 3), 2);
  });

  it("resolves a quote on page 3 via form feeds", () => {
    const text = "First page content.\fSecond page content.\fThe procuring entity is the Ministry of Health.";
    assert.equal(locateQuoteProvenPage(text, "procuring entity is the Ministry of Health", 3), 3);
  });

  it("matches across line wraps and whitespace differences (normalized search)", () => {
    const text = "[Page 1]\nintro\n[Page 2]\nThe   submission\n   deadline is\t30 December 2026.";
    assert.equal(locateQuoteProvenPage(text, "the submission deadline is 30 december 2026", 2), 2);
  });

  it("maps the normalized match index back to the ORIGINAL offset (page boundaries counted in original text)", () => {
    // Lots of whitespace before the form feed: in the NORMALIZED string the
    // match lands at a much smaller index than in the original. If the
    // normalized offset were (incorrectly) used against the original text,
    // the form feed would not precede it and the page would be wrong.
    const padding = "intro " + "   \n\n\t".repeat(200);
    const text = padding + "\f" + "unique quoted passage on the second page";
    assert.equal(locateQuoteProvenPage(text, "unique quoted passage on the second page", 2), 2);
  });
});

describe("locateQuoteProvenPage — fail-closed rules", () => {
  it("returns null when the quote is NOT found (never offset-0 / page 1)", () => {
    // Regression: the old guard fell back to index 0 when the prefix search
    // missed, which computed page 1 from the document start.
    const text = "Page one content here.\fPage two content here.";
    assert.equal(locateQuoteProvenPage(text, "this quote does not exist anywhere in the file", 2), null);
  });

  it("a shared 20-char prefix must NOT prove the page (full quote elsewhere)", () => {
    // Both pages start a sentence with the same 24-char prefix; the FULL
    // quote only exists on page 3. Prefix matching would return page 1.
    const text =
      "[Page 1]\nThe contracting entity reserves the right to reject bids.\n" +
      "[Page 2]\nOther content.\n" +
      "[Page 3]\nThe contracting entity shall award the contract to the lowest evaluated bidder.";
    assert.equal(
      locateQuoteProvenPage(text, "The contracting entity shall award the contract to the lowest evaluated bidder", 3),
      3,
    );
  });

  it("duplicate quote across DIFFERENT pages is ambiguous → null", () => {
    const text =
      "[Page 1]\nBids must be submitted in a sealed envelope.\n" +
      "[Page 2]\nOther content.\n" +
      "[Page 3]\nBids must be submitted in a sealed envelope.";
    assert.equal(locateQuoteProvenPage(text, "Bids must be submitted in a sealed envelope", 3), null);
  });

  it("duplicate quote on the SAME page stays proven", () => {
    const text =
      "[Page 1]\nIntro.\n" +
      "[Page 2]\nThe deadline is 30 June 2026. We repeat: the deadline is 30 June 2026.";
    assert.equal(locateQuoteProvenPage(text, "the deadline is 30 June 2026", 2), 2);
  });

  it("boundaryless multi-page text (totalPages=3) cannot receive page-1 evidence", () => {
    const text = "No page markers anywhere in this blob. The submission deadline is 30 December 2026. More text.";
    assert.equal(locateQuoteProvenPage(text, "submission deadline is 30 December 2026", 3), null);
  });

  it("boundaryless totalPages=1 text may receive page 1", () => {
    const text = "Single page document. The submission deadline is 30 December 2026.";
    assert.equal(locateQuoteProvenPage(text, "submission deadline is 30 December 2026", 1), 1);
  });

  it("boundaryless text with UNKNOWN totalPages (null) gets no page", () => {
    const text = "No markers. The submission deadline is 30 December 2026.";
    assert.equal(locateQuoteProvenPage(text, "submission deadline is 30 December 2026", null), null);
  });

  it("a computed page beyond stored totalPages → null (fabricated evidence blocked)", () => {
    // Marker claims page 7 but the stored PDF has 3 pages → markers unreliable.
    const text = "[Page 7]\nThe submission deadline is 30 December 2026.";
    assert.equal(locateQuoteProvenPage(text, "submission deadline is 30 December 2026", 3), null);
  });

  it("short quotes (< 6 normalized chars) are rejected", () => {
    const text = "[Page 1]\nab cd.";
    assert.equal(locateQuoteProvenPage(text, "ab cd", 1), null);
  });

  it("null/empty text or quote → null", () => {
    assert.equal(locateQuoteProvenPage(null, "some meaningful quote", 1), null);
    assert.equal(locateQuoteProvenPage("some text body here", null, 1), null);
    assert.equal(locateQuoteProvenPage("", "some meaningful quote", 1), null);
  });

  it("boilerplate repeated beyond the occurrence cap → null", () => {
    const line = "Standard footer text repeated on every page. ";
    const text = "[Page 1]\n" + line.repeat(250);
    assert.equal(locateQuoteProvenPage(text, "Standard footer text repeated on every page", 1), null);
  });
});

describe("computeProvenPageNumber — bounds preserved (unchanged contract)", () => {
  it("no boundary + totalPages > 1 → null", () => {
    assert.equal(computeProvenPageNumber("plain text", 3, 3), null);
  });
  it("no boundary + totalPages === 1 → 1", () => {
    assert.equal(computeProvenPageNumber("plain text", 3, 1), 1);
  });
  it("form-feed page beyond totalPages → null", () => {
    assert.equal(computeProvenPageNumber("a\fb\fc\fd", 6, 2), null);
  });
});

describe("ai-analyze route + durable worker use the canonical resolver (source shape)", () => {
  const { readFileSync } = require("node:fs");
  const routeSrc = readFileSync("app/api/tenders/[id]/ai-analyze/route.ts", "utf8");
  const workerSrc = readFileSync("lib/ai-jobs/analysis-job-service.ts", "utf8");

  for (const [name, src] of [["ai-analyze route", routeSrc], ["durable worker", workerSrc]] as const) {
    it(`${name}: calls locateQuoteProvenPage and never prefix/offset-0 matches`, () => {
      assert.ok(src.includes("locateQuoteProvenPage("), `${name} must call locateQuoteProvenPage`);
      assert.ok(!src.includes("slice(0, Math.min(20"), `${name} must not use 20-char prefix page proof`);
      assert.ok(!src.includes("idx >= 0 ? idx : 0"), `${name} must not fall back to offset 0 for unfound quotes`);
    });
  }
});
