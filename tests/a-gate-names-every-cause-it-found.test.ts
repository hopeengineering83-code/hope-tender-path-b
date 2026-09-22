// ─── A gate names every cause it found, not the first one ───────────────────
//
// THE DEFECT. Two release gates reduced a validator's list to its head:
//
//   metadataGateBlocker  = validation.blockers[0]     ?? "...";
//   buildPlanGateBlocker = itemValidation.blockers[0] ?? "...";
//
// Both validators emit one named, field-specific sentence PER failing field --
// `validateCriticalMetadataEvidenceForBuildPlan` pushes
// "Critical metadata field <label> has no meaningful source quote.",
// "... has no active TenderFile source evidence.", "... source page N exceeds
// file total pages M.", and so on. An owner with three ungrounded fields was
// told about one, repaired it, was told about the next, and repaired that,
// learning the size of the problem only by exhausting it.
//
// This is the same rule the canonical workflow decision applies one layer up
// (tests/a-locked-zip-must-name-what-locks-it.test.ts): NAME what blocks, do
// not collapse it. The sentence this produces is what the owner now reads as
// nextRequiredActionReason, so the two layers agree.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeGateBlockers, MAX_NAMED_GATE_CAUSES } from "../lib/engine/release-snapshot-eligibility";

const FALLBACK = "Final Tender Facts are not source-grounded or audit-authorized.";

describe("a gate names every cause it found", () => {
  it("names all of them when a validator reports several", () => {
    const rendered = describeGateBlockers([
      "Critical metadata field Submission Address has no meaningful source quote.",
      "Critical metadata field Deadline has no active TenderFile source evidence.",
      "Critical metadata field Client Name has no value.",
    ], FALLBACK);
    assert.match(rendered, /Submission Address/);
    assert.match(rendered, /Deadline/);
    assert.match(rendered, /Client Name/);
  });

  it("no longer answers with the first cause alone", () => {
    const blockers = [
      "Critical metadata field Submission Address has no meaningful source quote.",
      "Critical metadata field Deadline has no active TenderFile source evidence.",
    ];
    assert.notEqual(describeGateBlockers(blockers, FALLBACK), blockers[0]);
  });

  it("reports a single cause as itself, with nothing added", () => {
    const only = "Critical metadata field Client Name has no value.";
    assert.equal(describeGateBlockers([only], FALLBACK), only);
  });

  it("bounds the sentence and says how many it did not show", () => {
    const many = Array.from({ length: MAX_NAMED_GATE_CAUSES + 3 }, (_, i) => `Cause ${i + 1}.`);
    const rendered = describeGateBlockers(many, FALLBACK);
    assert.match(rendered, /Cause 1\./);
    assert.match(rendered, new RegExp(`Cause ${MAX_NAMED_GATE_CAUSES}\\.`));
    assert.equal(rendered.includes(`Cause ${MAX_NAMED_GATE_CAUSES + 1}.`), false);
    assert.match(rendered, /\(and 3 more\)/);
  });

  it("falls back rather than going quiet when a validator fails without saying why", () => {
    for (const empty of [[], null, undefined, ["", "   "]]) {
      assert.equal(describeGateBlockers(empty, FALLBACK), FALLBACK);
    }
  });

  it("invents no vocabulary of its own", () => {
    const rendered = describeGateBlockers(["Cause one.", "Cause two."], FALLBACK);
    assert.equal(rendered, "Cause one. Cause two.");
  });

  it("carries no tender, sector, client or benchmark knowledge", () => {
    const SRC = readFileSync("lib/engine/release-snapshot-eligibility.ts", "utf8");
    const region = SRC.slice(SRC.indexOf("export function describeGateBlockers"));
    assert.equal(/pharo|ethiop|addis|healthcare|architect|consultanc/i.test(region), false);
  });
});
