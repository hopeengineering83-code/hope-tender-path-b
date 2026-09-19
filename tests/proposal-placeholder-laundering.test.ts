// Regression test: the benchmark guard must not launder placeholders past its
// own detector.
//
// normalizeWeakText() rewrites every placeholder, TBD, TODO, template variable
// and AI refusal it finds into the phrase "to be confirmed by bid team", and it
// runs BEFORE hasForbiddenWeakness() scores the document. That detector tested
// for "placeholder", "tbd", "todo", "to be determined" and friends — none of
// which survive the rewrite. So a proposal left full of unresolved spots scored
// +5 and collected the strength "No obvious AI/placeholder/TBD language
// detected": the pipeline asserting confidence exactly where it had none, and
// the module's own reviewer checklist ("Confirm that no placeholder wording
// remains") guaranteed to be answered wrongly.
//
// Rewriting a raw `${var}` into readable wording is still worth doing. Calling
// the result clean is not. These tests pin the honest behavior.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  countUnresolvedPlaceholders,
  finalizeClientReadyProposalMarkdown,
  scoreBenchmarkProposalMarkdown,
  type BenchmarkGuardInput,
} from "../lib/engine/proposal-benchmark-guard";

// Typed, not cast: an `as` here would let a missing required field reach the
// function as undefined and fail at runtime instead of at the compiler.
const input: BenchmarkGuardInput = {
  tenderTitle: "Adama Water Supply Design",
  clientName: "Oromia Water Bureau",
  companyName: "Hope Engineering PLC",
  submissionNotes: "Submit one original and two copies before the deadline.",
  expertCount: 4,
  projectCount: 6,
  complianceLines: ["Bidder shall hold a valid trade licence."],
  topProjectNames: ["Adama Water Supply Design"],
  topExpertName: "Dawit Bekele",
};

describe("benchmark guard — unresolved placeholders stay visible", () => {
  it("counts the phrase the normalizer substitutes in", () => {
    assert.equal(countUnresolvedPlaceholders("all resolved here"), 0);
    assert.equal(
      countUnresolvedPlaceholders("Contract value to be confirmed by bid team."),
      1,
    );
    // Both spellings the normalizer can emit, in either case.
    assert.equal(
      countUnresolvedPlaceholders(
        "To be confirmed by bid team. Bid-team to confirm before submission.",
      ),
      2,
    );
  });

  it("does not award the clean-document strength when placeholders remain", () => {
    const dirty = [
      "## Cover Letter",
      "Contract value to be confirmed by bid team.",
      "Start date to be confirmed by bid team.",
    ].join("\n");

    const score = scoreBenchmarkProposalMarkdown(dirty, input);

    assert.ok(
      !score.strengths.some((s) => /No obvious AI\/placeholder\/TBD language detected/.test(s)),
      "a document with unresolved spots must not be reported as free of placeholder language",
    );
    assert.ok(
      score.gaps.some((g) => /unresolved spot/i.test(g)),
      "the unresolved spots must be named as a gap",
    );
    assert.ok(
      score.gaps.some((g) => /\b2\b/.test(g)),
      "the gap must state how many spots remain, not just that some exist",
    );
  });

  it("survives the normalizer: rewritten placeholders are still counted", () => {
    // TBD/TODO/template syntax are exactly what normalizeWeakText() rewrites.
    // Before the fix this document finished as "clean".
    const raw = [
      "## Cover Letter",
      "We are pleased to submit this proposal.",
      "## Executive Summary",
      "Contract value: TBD.",
      "Delivery window: ${DELIVERY_WINDOW}.",
      "Signatory: [INSERT NAME].",
    ].join("\n");

    const finalized = finalizeClientReadyProposalMarkdown(raw, input);

    assert.ok(
      finalized.unresolvedPlaceholderCount > 0,
      "rewritten placeholders must be reported on the result, not silently absorbed",
    );
    assert.ok(
      !finalized.score.strengths.some((s) => /No obvious AI\/placeholder\/TBD language detected/.test(s)),
      "the finalized document must not claim to be free of placeholder language",
    );
    assert.match(
      finalized.internalSummary,
      /unresolved placeholders: \d+/,
      "the internal summary must state the unresolved count",
    );
  });

  it("still reports a genuinely clean proposal as clean", () => {
    const clean = [
      "## Cover Letter",
      "Hope Engineering PLC is pleased to submit this proposal to Oromia Water Bureau",
      "for the Adama Water Supply Design assignment.",
      "## Executive Summary",
      "We have already delivered this assignment: the Adama Water Supply Design,",
      "completed for ETB 24,500,000.",
    ].join("\n");

    const score = scoreBenchmarkProposalMarkdown(clean, input);

    assert.equal(countUnresolvedPlaceholders(clean), 0);
    assert.ok(
      score.strengths.some((s) => /No obvious AI\/placeholder\/TBD language detected/.test(s)),
      "a genuinely clean document must still earn the clean-language strength",
    );
    assert.ok(
      !score.gaps.some((g) => /unresolved spot/i.test(g)),
      "a clean document must not be reported as carrying unresolved spots",
    );
  });
});
