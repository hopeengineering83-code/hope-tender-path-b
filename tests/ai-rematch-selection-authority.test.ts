// AI rematch selection-authority regression test (PR XX-AI-REMATCH-FIX).
//
// THE BUG
// ───────
// applyAIRematchToMainEngine had this expression:
//   const selected = selectedExpertIds.has(match.expertId) || match.isSelected;
//
// The `||` meant the AI rematch could ONLY ADD selections — never unselect.
// If the deterministic engine force-promoted a warehouse over the 0.55
// floor for a healthcare tender, the AI's 12-perspective view that
// correctly rejected the warehouse was IGNORED. The warehouse stayed
// selected end-to-end.
//
// THE FIX
// ───────
// When the AI returns an assessment for a candidate, the AI's selection
// decision is now authoritative:
//   const selected = selectedExpertIds.has(match.expertId);
//
// When the AI did NOT assess a candidate (not in pre-filter top-N, AI
// failed for that row, etc.), the deterministic isSelected is preserved.
//
// SCOPE
// ─────
// This test isolates the merge semantics by hand-rolling a tiny test
// for the bug shape — verifying that an AI rejection authoritatively
// overrides a deterministic selection when the AI assessed the row.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

type Match = { expertId: string; isSelected: boolean; score: number };

// Reproduces the EXACT line-of-code shape we changed in
// applyAIRematchToMainEngine. Keep this in sync with that file.
function mergeSelectionsBefore(
  match: Match,
  selectedExpertIds: Set<string>,
  hasAssessment: boolean,
): boolean {
  // BUG (pre-fix): always include the deterministic flag.
  // hasAssessment is ignored — selection is the OR of AI and deterministic.
  if (!hasAssessment) return match.isSelected;
  return selectedExpertIds.has(match.expertId) || match.isSelected;
}

function mergeSelectionsAfter(
  match: Match,
  selectedExpertIds: Set<string>,
  hasAssessment: boolean,
): boolean {
  // FIX (post-fix): when AI assessed this row, AI is authoritative.
  // Otherwise preserve deterministic.
  if (!hasAssessment) return match.isSelected;
  return selectedExpertIds.has(match.expertId);
}

describe("AI rematch selection-authority semantics", () => {
  it("BEFORE fix: deterministic warehouse stays selected even when AI rejects it", () => {
    const warehouseMatch: Match = { expertId: "warehouse-exp", isSelected: true, score: 0.58 };
    const aiSelectedIds = new Set<string>(); // AI did NOT select the warehouse
    // Pre-fix behaviour reproduces the bug.
    assert.equal(mergeSelectionsBefore(warehouseMatch, aiSelectedIds, true), true,
      "BEFORE fix: warehouse should remain selected via OR — this proves the bug");
  });

  it("AFTER fix: warehouse is unselected because AI rejected it", () => {
    const warehouseMatch: Match = { expertId: "warehouse-exp", isSelected: true, score: 0.58 };
    const aiSelectedIds = new Set<string>(); // AI did NOT select the warehouse
    assert.equal(mergeSelectionsAfter(warehouseMatch, aiSelectedIds, true), false,
      "AFTER fix: AI's rejection authoritatively overrides deterministic selection");
  });

  it("AFTER fix: AI-selected hospital expert is selected even when deterministic missed it", () => {
    const hospitalMatch: Match = { expertId: "hospital-exp", isSelected: false, score: 0.88 };
    const aiSelectedIds = new Set<string>(["hospital-exp"]);
    assert.equal(mergeSelectionsAfter(hospitalMatch, aiSelectedIds, true), true,
      "AI selection promotes the row even when deterministic didn't select it");
  });

  it("AFTER fix: when AI did not assess this row, deterministic decision is preserved", () => {
    const unassessedMatch: Match = { expertId: "unassessed-exp", isSelected: true, score: 0.92 };
    const aiSelectedIds = new Set<string>();
    assert.equal(mergeSelectionsAfter(unassessedMatch, aiSelectedIds, false), true,
      "Row not in AI top-N keeps its deterministic isSelected flag");

    const unassessedMatch2: Match = { expertId: "unassessed-2", isSelected: false, score: 0.40 };
    assert.equal(mergeSelectionsAfter(unassessedMatch2, aiSelectedIds, false), false,
      "Row not in AI top-N keeps deterministic isSelected=false too");
  });

  it("AFTER fix: AI confirmation preserves a deterministic selection", () => {
    const goodMatch: Match = { expertId: "good-exp", isSelected: true, score: 0.95 };
    const aiSelectedIds = new Set<string>(["good-exp"]);
    assert.equal(mergeSelectionsAfter(goodMatch, aiSelectedIds, true), true,
      "AI confirmation of a deterministic pick keeps it selected");
  });
});
