// Regression guard (FM-008 class): the Tender model has NO `analysisSource`
// column — the analysis source is recorded in `tender.notes`. Consumers that
// read a non-existent `tender.analysisSource` field always saw `undefined`,
// silently degrading their behaviour. #814 fixed workflow-state.ts and
// tender-readiness-state.ts; this guard locks the two remaining consumers:
//   - app/dashboard/.../executive-snapshot.tsx (GO/REVIEW/NO_GO decision)
//   - lib/engine/generate-elite.ts (bid-strategy win-probability penalty)

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

describe("executive-snapshot derives analysis trust from notes, not the missing field", () => {
  const src = readFileSync("app/dashboard/tenders/[id]/executive-snapshot.tsx", "utf8");

  it("imports and uses detectAnalysisSource(tender)", () => {
    assert.match(src, /import \{ detectAnalysisSource \} from "@\/lib\/engine\/analysis-source"/);
    assert.match(src, /detectAnalysisSource\(tender\)/);
  });

  it("does not gate GO on a raw (tender.analysisSource ?? \"\") read", () => {
    assert.doesNotMatch(src, /\(tender\.analysisSource \?\? ""\)\.toUpperCase\(\)/);
  });
});

describe("generate-elite passes a derived analysisSource into computeBidStrategy", () => {
  const src = readFileSync("lib/engine/generate-elite.ts", "utf8");

  it("imports detectAnalysisSource and sets analysisSource in the bid-strategy input", () => {
    assert.match(src, /import \{ detectAnalysisSource \} from "\.\/analysis-source"/);
    assert.match(src, /analysisSource: detectAnalysisSource\(tender\)/);
  });
});
