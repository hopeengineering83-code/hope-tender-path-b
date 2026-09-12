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

// app/dashboard/tenders/[id]/executive-snapshot.tsx was removed entirely as
// part of the app-wide consolidation onto the canonical Tender Release
// State. The FM-008-class property it protected — never reimplement an
// analysis-source resolver or read the nonexistent tender.analysisSource
// column — still holds in the replacement: lib/engine/tender-release-state.ts
// and components/tender-release-state-panel.tsx reference neither
// tender.analysisSource nor detectAnalysisSource(tender) (confirmed by grep);
// grounding is instead read from getTenderReleaseSnapshot's
// analysis.eligibleForExport, which goes through the established
// resolveTenderAnalysisState resolver.

describe("generate-elite passes a derived analysisSource into computeBidStrategy", () => {
  const source = readFileSync("lib/engine/generate-elite.ts", "utf8");

  it("imports detectAnalysisSource and sets analysisSource in the bid-strategy input", () => {
    assert.match(source, /import \{ detectAnalysisSource \} from "\.\/analysis-source"/);
    assert.match(source, /analysisSource: detectAnalysisSource\(tender\)/);
  });
});
