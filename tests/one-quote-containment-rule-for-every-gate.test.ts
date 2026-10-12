// 2026-09-29, Preview, a new tender: AI Analyze promoted its requirements with
// quotes the grounding check accepted, and Run Engine then stopped at the
// Build Plan: "REQUIREMENT_QUOTE_NOT_IN_FILE: Mandatory requirement … source
// quote is not contained in the referenced active TenderFile". The two used
// different containment rules — the grounding check folds dash variants and
// list glyphs a PDF extractor emits for the same printed text, the Build Plan
// and the readiness gate only folded case and whitespace. One rule now.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { isGroundedEvidenceInActiveFiles, normalizeForContainment } from "../lib/engine/evidence-grounding";

describe("one quote-containment rule for every gate", () => {
  it("a quote typed with a hyphen is contained in text printed with an en dash", () => {
    const fileText = "Bids shall remain valid for 90 days – counted from the closing date.";
    const quote = "Bids shall remain valid for 90 days - counted from the closing date.";
    assert.ok(normalizeForContainment(fileText).includes(normalizeForContainment(quote)));
    assert.equal(isGroundedEvidenceInActiveFiles(1, quote, "f1", [{ id: "f1", extractedText: fileText, totalPages: 1 }]), true);
  });

  it("the Build Plan and the readiness gate use it", () => {
    for (const path of ["lib/engine/build-plan.ts", "lib/engine/generation-readiness-gate.ts"]) {
      const src = readFileSync(path, "utf8");
      assert.match(src, /const normalizedQuote = normalizeForContainment\(quote\)/, path);
      assert.doesNotMatch(src, /const normalizedQuote = quote\.toLowerCase\(\)/, path);
    }
  });
});
