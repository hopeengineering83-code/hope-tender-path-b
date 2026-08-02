// "Repair all empty fields from source" batch button — source-level wiring.
// Behavioural runtime test would need React + auth + Prisma — assertions are
// kept at source level so they're deterministic and fast.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("GenerationActionPanel surfaces a one-click 'Repair all' batch action", () => {
  const source = readFileSync("components/generation-action-panel.tsx", "utf8");

  it("defines a runRepairAllMetadata handler that POSTs every supported field", () => {
    assert.match(source, /async function runRepairAllMetadata/);
    assert.match(source, /fields:\s*ALL_REPAIRABLE_FIELDS/);
  });

  it("ALL_REPAIRABLE_FIELDS covers the full extractor manifest", () => {
    for (const field of [
      "evaluationMethodology",
      "reference",
      "deadline",
      "submissionEmails",
      "submissionMethod",
      "pageLimit",
      "validityDays",
      "bidBondAmount",
      "numberOfCopiesRequired",
      "mandatorySiteVisit",
    ]) {
      assert.match(source, new RegExp(`"${field}"`));
    }
  });

  it("uses parseRepairMetadataResponse to validate the API response shape", () => {
    assert.match(source, /parseRepairMetadataResponse/);
    assert.match(source, /buildRepairMessage/);
    assert.doesNotMatch(source, /data\.results\.filter/);
  });

  it("router.refresh fires ONLY when parsed.success is true", () => {
    const successBranch = source.match(/if \(parsed\.success\)[\s\S]{0,300}/);
    assert.ok(successBranch, "parsed.success branch must exist");
    assert.match(successBranch![0], /router\.refresh/);
  });

  it("the batch button is rendered only when metadataBlockerPresent is true (guarded by canMutate)", () => {
    // The button is now guarded by canMutate AND metadataBlockerPresent so
    // REVIEWER users never see it.
    assert.match(source, /\{canMutate\s*&&\s*metadataBlockerPresent\s*&&\s*\(/);
    assert.match(source, /Repair Tender Details from source/);
  });

  it("offers exactly one repair control, not two scopes of the same call", () => {
    // There used to be a second, narrower button posting
    // {fields:["evaluationMethodology"]} — a strict subset of
    // ALL_REPAIRABLE_FIELDS, behind ~48 lines of duplicated fetch and error
    // handling. It asked the user to choose between two spellings of the same
    // remedy. evaluationMethodology is the first entry of the batch manifest,
    // so nothing it could repair was lost.
    assert.doesNotMatch(source, /Repair evaluation criteria only/);
    assert.doesNotMatch(source, /async function runRepairMetadata\(\)/);
    assert.doesNotMatch(source, /fields:\s*\["evaluationMethodology"\]/);
    assert.match(source, /"evaluationMethodology",/, "the field is still repaired, via the batch manifest");
  });

  // Merged from the former tests/repair-metadata-button-wiring.test.ts, which
  // covered the deleted narrow button and otherwise duplicated this file.
  it("computes metadataBlockerPresent from the blocker code, not free-text matching", () => {
    assert.match(source, /metadataBlockerPresent\s*=\s*fullProposalBlockers\.some\(\(b\)\s*=>\s*b\.code === "FINAL_PACKAGE_FACTS_UNCONFIRMED"/);
    assert.match(source, /FULL_PROPOSAL_METADATA_INCOMPLETE/);
  });

  it("states the source-grounded intent in the surviving control", () => {
    assert.match(source, /Repair Tender Details from source/);
    assert.match(source, /source-grounded/i);
  });

  it("does not weaken the Generate Docs disable rule", () => {
    assert.match(source, /disabled=\{!fullProposalReady \|\| running \|\| isPending\}/);
  });
});
