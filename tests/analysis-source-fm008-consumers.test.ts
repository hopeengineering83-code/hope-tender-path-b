// Regression guard (FM-008 class): the Tender model has no `analysisSource`
// column. Analysis source lives in `tender.notes` and must be resolved through
// the shared analysis-source authority. The executive snapshot no longer owns
// an independent analysis-source gate: it renders the canonical readiness
// result produced server-side. Generate-elite still consumes the pure resolver
// directly for its bid-strategy input.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { detectAnalysisSource } from "../lib/engine/analysis-source";

describe("detectAnalysisSource reads the notes marker (the real source of truth)", () => {
  it("returns AI / REGEX_FALLBACK_AI_ERROR / UNKNOWN from tender.notes", () => {
    assert.equal(detectAnalysisSource({ notes: "Analysis source: AI (re-run via AI Analyze button)." }), "AI");
    assert.equal(detectAnalysisSource({ notes: "Analysis source: regex fallback (REGEX_FALLBACK_AI_ERROR). providers down" }), "REGEX_FALLBACK_AI_ERROR");
    assert.equal(detectAnalysisSource({ notes: null }), "UNKNOWN");
    assert.equal(detectAnalysisSource({ notes: "no marker here" }), "UNKNOWN");
  });
});

describe("executive snapshot delegates analysis trust to canonical readiness", () => {
  const source = readFileSync("app/dashboard/tenders/[id]/executive-snapshot.tsx", "utf8");

  it("uses canonical final-package readiness for GO/REVIEW/NO_GO", () => {
    assert.match(source, /canonicalReadiness\?\.readyForFinalExport/);
    assert.match(source, /canonicalReadiness\?\.modules\.export\.state/);
    assert.match(source, /Final package status/);
  });

  it("does not recreate an analysis-source resolver or read a missing model field", () => {
    assert.doesNotMatch(source, /tender\.analysisSource/);
    assert.doesNotMatch(source, /detectAnalysisSource\(tender\)/);
    assert.doesNotMatch(source, /Analysis source:\s*regex fallback/i);
  });
});

describe("generate-elite passes a derived analysisSource into computeBidStrategy", () => {
  const source = readFileSync("lib/engine/generate-elite.ts", "utf8");

  it("imports detectAnalysisSource and sets analysisSource in the bid-strategy input", () => {
    assert.match(source, /import \{ detectAnalysisSource \} from "\.\/analysis-source"/);
    assert.match(source, /analysisSource: detectAnalysisSource\(tender\)/);
  });
});
