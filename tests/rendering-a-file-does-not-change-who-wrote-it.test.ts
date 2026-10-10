import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * THE DEFECT, read off the 2026-09-15 acceptance run.
 * ---------------------------------------------------
 * The hosted acceptance went green end to end and produced a real ZIP. Asked
 * who wrote the proposal, the product answered:
 *
 *   DOCUMENT AUTHORSHIP: 1 document(s)
 *     - 'Technical Proposal.pdf'
 *         reviewStatus='PENDING' mode='(no contentSummary)'
 *
 * generate-elite always writes contentSummary, beginning with the mode label
 * that names the provider that authored the section or the deterministic
 * fallback that stood in for it. The DOCX had it. The finalized PDF — which
 * REPLACES that DOCX as the deliverable — was written without it, because
 * `finalizedPdfData` inherited exactOrder from the source row and nothing else.
 *
 * So the artifact the client actually receives carried no record of whether a
 * model or a deterministic template wrote it, and the question the benchmark
 * turns on could not be answered from the product at all.
 *
 * The same file already documents this mistake once, one field over: exactOrder
 * was omitted from the same select and a finalized PDF was written with no
 * position. Provenance is lost at boundaries, and a format render is a boundary.
 */

const service = readFileSync("lib/ai-jobs/auto-finalize-continuation-service.ts", "utf8");

/** The finalization region: the select that feeds it through the write. */
function finalizationRegion(): string {
  const start = service.indexOf("// exactOrder is selected because the finalized PDF inherits its position");
  assert.ok(start >= 0, "expected the finalization select to be findable");
  const end = service.indexOf("generatedDocument.create({ data: finalizedPdfData })", start);
  assert.ok(end > start, "expected the finalized-PDF write after the select");
  return service.slice(start, end);
}

describe("rendering a file does not change who wrote it", () => {
  it("reads the source document's authorship", () => {
    const region = finalizationRegion();
    assert.match(
      region,
      /select:\s*\{[\s\S]*?contentSummary:\s*true/,
      "the finalization query must select contentSummary, or the render has nothing to carry",
    );
  });

  it("carries that authorship onto the finalized PDF", () => {
    const region = finalizationRegion();
    assert.match(
      region,
      /sourceDoc\.contentSummary\s*\?\s*\{\s*contentSummary:\s*sourceDoc\.contentSummary\s*\}/,
      "the finalized PDF must inherit the source document's authorship",
    );
  });

  it("does not invent authorship when the source has none", () => {
    // A conditional spread, not a default string. A PDF rendered from a DOCX
    // that never recorded its author must stay silent rather than assert one —
    // fabricated provenance is worse than absent provenance.
    const region = finalizationRegion();
    assert.doesNotMatch(
      region,
      /contentSummary:\s*sourceDoc\.contentSummary\s*(\?\?|\|\|)\s*["'`]/,
      "must not substitute a placeholder author when the source has none",
    );
  });

  it("still inherits position, so this fix did not displace the previous one", () => {
    const region = finalizationRegion();
    assert.match(region, /exactOrder:\s*true/);
    assert.match(region, /inheritedExactOrder != null \? \{ exactOrder: inheritedExactOrder \}/);
  });

  it("is about provenance in general, not one tender or one sector", () => {
    const region = finalizationRegion();
    for (const word of ["pharo", "hospital", "healthcare", "22b5e12e"]) {
      assert.ok(!region.toLowerCase().includes(word), `the rule must not name ${word}`);
    }
  });
});
