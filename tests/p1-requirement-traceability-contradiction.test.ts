// Reproduces a contradiction observed on the live Preview (commit 895d955e).
//
// One tender, four mandatory requirements, three panels disagreeing:
//
//   Workflow panel   "Trusted traced requirements (mandatory): 4/4"
//   Analysis panel   "Grounding 100"
//   Bid strategy     "Extracted requirements have no source traceability."
//                    → "Bid Strategy unavailable"
//
// All three read the same rows. The disagreement was entirely in the predicate:
// bid-strategy counted only requirements whose AI-supplied `sourceConfidence`
// was > 0. That field is a model-reported score, not a source anchor —
// mapToDraft stores `sourceTenderFileId ? (req.sourceConfidence ?? 0) : 0`, so a
// requirement with a real file, a proven page and a verbatim quote still scores
// 0 whenever the model omitted it.
//
// The fix is one shared predicate. These tests pin the behaviour that broke:
// a fully grounded requirement with no confidence score IS traceable.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

/** Exactly the shape the screenshot tender had: grounded, but no confidence. */
const GROUNDED_WITHOUT_CONFIDENCE = {
  sourceTenderFileId: "11111111-1111-4111-8111-111111111111",
  sourcePageNumber: 3,
  sourceExactQuote: "Bidders shall submit a valid ISO 9001 certificate with the technical proposal.",
  sectionReference: "Section 3.2",
  sourceConfidence: 0,
};

describe("canonical requirement traceability", () => {
  it("treats a fully grounded requirement with zero confidence as traceable", async () => {
    const { hasSourceTraceability } = await import("../lib/engine/requirement-source-traceability");

    // The exact regression: confidence 0 previously meant "no traceability".
    assert.equal(hasSourceTraceability(GROUNDED_WITHOUT_CONFIDENCE), true);
  });

  it("counts every grounded requirement, matching what the workflow panel reports", async () => {
    const { countTraceable } = await import("../lib/engine/requirement-source-traceability");

    const four = Array.from({ length: 4 }, () => ({ ...GROUNDED_WITHOUT_CONFIDENCE }));
    assert.equal(
      countTraceable(four),
      4,
      "4/4 traced in one panel must not be 0 refs in another",
    );
  });

  it("does not treat a bare confidence score as a source anchor", async () => {
    const { hasSourceTraceability } = await import("../lib/engine/requirement-source-traceability");

    // Confidence ranks how sure the model was. It anchors nothing, so on its own
    // it must NOT make a requirement count as traceable — the inverse of the old
    // bug, and just as wrong.
    assert.equal(
      hasSourceTraceability({
        sourceTenderFileId: null,
        sourcePageNumber: null,
        sourceExactQuote: null,
        sectionReference: null,
        sourceConfidence: 0.95,
      }),
      false,
      "a confidence score alone is not source traceability",
    );
  });

  it("still reports genuinely untraceable requirements as untraceable", async () => {
    const { hasSourceTraceability, countTraceable } = await import("../lib/engine/requirement-source-traceability");

    const bare = { sourceTenderFileId: null, sourcePageNumber: null, sourceExactQuote: null, sectionReference: null, sourceConfidence: null };
    assert.equal(hasSourceTraceability(bare), false);
    assert.equal(countTraceable([bare, bare]), 0, "the blocker must still fire when nothing is anchored");
  });

  it("keeps the strict grounding bar separate from mere traceability", async () => {
    const { hasSourceTraceability, isFullyGrounded } = await import("../lib/engine/requirement-source-traceability");

    // A section heading anchors a reviewer, but it is not the file+page+quote
    // triple the export gates require. Collapsing the two questions into one
    // predicate is how the divergence started.
    const headingOnly = {
      sourceTenderFileId: null,
      sourcePageNumber: null,
      sourceExactQuote: null,
      sectionReference: "Section 3.2",
      sourceConfidence: null,
    };
    assert.equal(hasSourceTraceability(headingOnly), true, "a heading is a real anchor");
    assert.equal(isFullyGrounded(headingOnly), false, "but it must never satisfy the strict gate");

    assert.equal(isFullyGrounded(GROUNDED_WITHOUT_CONFIDENCE), true, "file+page+quote is fully grounded");
    assert.equal(
      isFullyGrounded({ ...GROUNDED_WITHOUT_CONFIDENCE, sourceExactQuote: "short" }),
      false,
      "a stub quote must not satisfy the strict gate",
    );
  });

  it("bid strategy no longer uses sourceConfidence as its traceability test", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("app/api/tenders/[id]/bid-strategy/route.ts", "utf8");

    assert.ok(
      !/sourceRefCount\s*=\s*tender\.requirements\.filter\(\(req\)\s*=>\s*\(req\.sourceConfidence/.test(source),
      "bid strategy must not derive traceability from sourceConfidence alone",
    );
    assert.match(
      source,
      /countTraceable\(tender\.requirements\)/,
      "bid strategy must use the shared canonical predicate",
    );
  });
});
