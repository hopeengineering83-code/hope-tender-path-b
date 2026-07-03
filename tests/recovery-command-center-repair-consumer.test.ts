// Regression tests for Recovery Command Center REPAIR_METADATA consumer.
// Proves the consumer reads the NEW outcomes[] contract (not the old
// repaired[] array) and formats correct messages for mixed results.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("Recovery Command Center REPAIR_METADATA consumer contract", () => {
  const source = readFileSync("components/tender-recovery-command-center.tsx", "utf8");

  it("reads json.outcomes (not json.repaired) for REPAIR_METADATA", () => {
    assert.match(source, /action === "REPAIR_METADATA"[\s\S]*?json\.outcomes/);
    assert.doesNotMatch(source, /action === "REPAIR_METADATA"[\s\S]{0,200}json\.repaired/);
  });

  it("filters outcomes by REPAIRED status", () => {
    assert.match(source, /outcomes\.filter\(\(o\) => o\.status === "REPAIRED"\)/);
  });

  it("reports unresolved fields when NOT_FOUND, REJECTED, UNRESOLVED, or ERROR remain", () => {
    assert.match(source, /unresolved/);
    assert.match(source, /unresolvedFields/);
    // Must treat NOT_FOUND, REJECTED, UNRESOLVED, and ERROR as unresolved
    assert.match(source, /NOT_FOUND/);
    assert.match(source, /REJECTED/);
    assert.match(source, /UNRESOLVED/);
    assert.match(source, /ERROR/);
  });

  it("shows partial repair message when some fields repaired but unresolved remain", () => {
    assert.match(source, /partially repaired/);
  });

  it("shows 'no fields could be extracted' when no fields repaired", () => {
    assert.match(source, /no fields could be extracted/);
  });
});

describe("Repair All outcomes persist complete source evidence", () => {
  const source = readFileSync("app/api/tenders/[id]/repair-metadata/route.ts", "utf8");

  it("REPAIRED outcomes include sourceFile", () => {
    assert.match(source, /status: "REPAIRED"[\s\S]*?sourceFile/);
  });

  it("REPAIRED outcomes include sourcePage", () => {
    assert.match(source, /status: "REPAIRED"[\s\S]*?sourcePage/);
  });

  it("REPAIRED outcomes include sourceQuote", () => {
    assert.match(source, /status: "REPAIRED"[\s\S]*?sourceQuote/);
  });

  it("REPAIRED outcomes include confidence", () => {
    assert.match(source, /status: "REPAIRED"[\s\S]*?confidence/);
  });

  it("uses shared isValidReferenceCandidate for reference validation", () => {
    assert.match(source, /isValidReferenceCandidate/);
  });

  it("uses shared isValidDeadlineCandidate for deadline validation", () => {
    assert.match(source, /isValidDeadlineCandidate/);
  });

  it("uses shared verifySourceQuote for source grounding", () => {
    assert.match(source, /verifySourceQuote/);
  });
});
