// Regression tests for the REPAIR_METADATA consumer contract.
// Proves the consumer reads the NEW outcomes[] contract (not the old
// repaired[] array) and formats correct messages for mixed results.
//
// components/tender-recovery-command-center.tsx (this file's original
// subject) was deleted as unrendered dead code (nothing imports or renders
// it). The live consumer today is components/generation-action-panel.tsx,
// which delegates outcome parsing/messaging to the shared
// lib/engine/repair-metadata-contract.ts module rather than inlining the
// logic — so the assertions below are redirected there. Some exact wording
// changed with the move to the shared module (e.g. there is no longer a
// literal "no fields could be extracted" string; the all-SKIPPED case now
// reads "All fields skipped"), so the checks assert the live phrasing
// rather than pretending the old strings still exist.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("REPAIR_METADATA consumer contract (shared repair-metadata-contract module)", () => {
  const contractSource = readFileSync("lib/engine/repair-metadata-contract.ts", "utf8");
  const panelSource = readFileSync("components/generation-action-panel.tsx", "utf8");

  it("the panel reads parsed.outcomes (not a raw json.repaired array) for REPAIR_METADATA", () => {
    assert.match(panelSource, /repair-metadata/);
    assert.match(panelSource, /parseRepairMetadataResponse/);
    assert.match(panelSource, /buildRepairMessage\(parsed\.outcomes\)/);
    assert.doesNotMatch(panelSource, /json\.repaired/);
  });

  it("parseRepairMetadataResponse reads the outcomes[] array, not a legacy repaired[] array", () => {
    assert.match(contractSource, /Array\.isArray\(obj\.outcomes\)/);
    assert.doesNotMatch(contractSource, /obj\.repaired/);
  });

  it("counts outcomes by REPAIRED status", () => {
    assert.match(contractSource, /counts\.REPAIRED/);
    assert.match(contractSource, /o\.status === "REPAIRED"/);
  });

  it("treats NOT_FOUND, REJECTED, UNRESOLVED, and ERROR as remaining/unresolved statuses", () => {
    assert.match(contractSource, /needsManualReview = counts\.NOT_FOUND \+ counts\.REJECTED \+ counts\.UNRESOLVED/);
    assert.match(contractSource, /"NOT_FOUND"/);
    assert.match(contractSource, /"REJECTED"/);
    assert.match(contractSource, /"UNRESOLVED"/);
    assert.match(contractSource, /"ERROR"/);
  });

  it("shows a partial-repair message when some fields repaired but others remain unresolved", () => {
    assert.match(contractSource, /field\(s\) remain unresolved — review and correct manually/);
  });

  it("shows an all-skipped message when no fields were repaired, not found, or rejected", () => {
    assert.match(contractSource, /All fields skipped/);
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
