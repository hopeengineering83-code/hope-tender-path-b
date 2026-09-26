import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { detectAnalysisSource } from "../lib/engine/analysis-source";

/**
 * The engine writes an analysis-source line into tender.notes and
 * analysis-source.ts reads it back. The two drifted: the writer emitted
 *
 *   "Analysis source: current AI Analyze output."
 *
 * which begins with "current", so it matched neither the AI pattern
 * (^analysis source:\s*ai\b) nor the regex-fallback pattern. Every successful
 * engine run therefore resolved to UNKNOWN, and a live tender whose AI_ANALYZE
 * job had SUCCEEDED reported analysisSource "UNKNOWN" on export-readiness, on
 * the readiness score (the analysisSource dimension scores 50 for UNKNOWN
 * against 100 for AI) and as "Unknown / risk MEDIUM" on the Analysis Quality
 * panel.
 *
 * Reading the literal out of the writer keeps the two ends pinned together:
 * changing the note without changing the detector fails here rather than in a
 * delivered proposal.
 */

function engineAnalysisSourceNote(): string {
  const source = readFileSync("lib/engine/run-tender-engine.ts", "utf8");
  const match = /"(Analysis source:[^"]*)"/.exec(source);
  assert.ok(match, "run-tender-engine.ts no longer writes an analysis-source note");
  return match[1];
}

test("the note the engine writes is recognised as an AI analysis", () => {
  const note = engineAnalysisSourceNote();
  assert.equal(detectAnalysisSource({ notes: `Engine run ID: abc\n${note}\n2 review item(s) remain.` }), "AI");
});

test("regex-fallback wording still blocks, so the fix loosens nothing", () => {
  assert.equal(
    detectAnalysisSource({ notes: "Analysis source: regex fallback (REGEX_FALLBACK_AI_ERROR). Providers exhausted." }),
    "REGEX_FALLBACK_AI_ERROR",
  );
  assert.equal(
    detectAnalysisSource({ notes: "Analysis source: regex fallback (REGEX_FALLBACK_NO_TEXT). No extracted text." }),
    "REGEX_FALLBACK_AI_ERROR",
  );
});

test("a tender with no analysis-source line is still UNKNOWN", () => {
  assert.equal(detectAnalysisSource({ notes: "Engine run ID: abc\n3 review item(s) remain." }), "UNKNOWN");
  assert.equal(detectAnalysisSource({ notes: null }), "UNKNOWN");
});

test("the fallback marker cannot be misread as the AI marker", () => {
  // "REGEX_FALLBACK_AI_ERROR" contains "AI"; the anchoring must still win.
  assert.equal(
    detectAnalysisSource({ notes: "Analysis source: regex fallback (REGEX_FALLBACK_AI_ERROR)." }),
    "REGEX_FALLBACK_AI_ERROR",
  );
});

test("the read-only surfaces resolve the source through the canonical resolver", () => {
  // resolveCanonicalAnalysisSource consults AiJob rows before falling back to
  // the notes detector, so a tender analysed before the wording fix — whose
  // notes still carry the old line — reports AI without needing a re-run.
  // The notes-only detector must not be what these surfaces call.
  for (const file of [
    "lib/engine/final-submission-readiness.ts",
    "lib/canonical-tender-readiness.ts",
    "app/api/tenders/[id]/analysis-quality/route.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.ok(source.includes("resolveCanonicalAnalysisSource"), `${file} should resolve through the canonical resolver`);
    assert.ok(
      !/await detectAnalysisSourceWithApproval\(/.test(source),
      `${file} still calls the notes-only detector`,
    );
  }
});
