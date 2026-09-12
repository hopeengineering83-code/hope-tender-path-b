// Gap 2+3: The repair-all-batch button was removed from the generation panel.
// The repair-metadata contract and route still exist for automatic use.
// These tests verify the old button patterns are gone.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("components/generation-action-panel.tsx", "utf8");

describe("Repair-all-batch button is removed (Gap 2+3)", () => {
  it("does NOT render the Repair Tender Details button", () => {
    assert.doesNotMatch(source, /Repair Tender Details from source/);
  });

  it("does NOT have canMutate && metadataBlockerPresent button guard", () => {
    assert.doesNotMatch(source, /canMutate\s*&&\s*metadataBlockerPresent\s*&&\s*\(/);
  });

  it("does NOT have runRepairAllMetadata function", () => {
    assert.doesNotMatch(source, /runRepairAllMetadata/);
  });

  it("does NOT have ALL_REPAIRABLE_FIELDS", () => {
    assert.doesNotMatch(source, /ALL_REPAIRABLE_FIELDS/);
  });

  it("does NOT have the Generate Docs disable rule (no button)", () => {
    assert.doesNotMatch(source, /disabled=\{!fullProposalReady/);
  });

  it("uses text-based status instead", () => {
    assert.match(source, /PROCESSING_AUTOMATICALLY/);
  });
});
