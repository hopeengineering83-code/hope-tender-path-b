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

  it("classifies each per-field result into REPAIRED / NOT_FOUND / SKIPPED buckets", () => {
    assert.match(source, /r\.status === "REPAIRED"/);
    assert.match(source, /r\.status === "NOT_FOUND"/);
    assert.match(source, /r\.status === "SKIPPED"/);
    assert.match(source, /repairedFields\.length/);
    assert.match(source, /notFoundFields\.length/);
    assert.match(source, /skippedFields\.length/);
  });

  it("router.refresh fires ONLY when at least one field was actually repaired", () => {
    // Locate the REPAIRED branch of the batch handler and confirm router.refresh is inside it.
    const repairedBranch = source.match(/if \(repairedFields\.length > 0\) \{[\s\S]{0,600}/);
    assert.ok(repairedBranch, "REPAIRED branch must exist");
    assert.match(repairedBranch![0], /router\.refresh\(\)/);
  });

  it("the batch button is rendered only when metadataBlockerPresent is true", () => {
    assert.match(source, /\{metadataBlockerPresent\s*&&\s*\(/);
    assert.match(source, /Repair all empty fields from source/);
  });

  it("the existing single-field button is preserved alongside the batch action", () => {
    assert.match(source, /Repair evaluationMethodology only/);
    // Single-field handler still exists.
    assert.match(source, /async function runRepairMetadata\(\)/);
  });

  it("does not weaken the Generate Docs disable rule", () => {
    assert.match(source, /disabled=\{!fullProposalReady \|\| running \|\| isPending\}/);
  });
});
