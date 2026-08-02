// Gap 1: Remove fabricated automation state from export repair.
//
// Automation (export-gap-repair, auto-finalize, and the run-next
// auto-finalize continuation) must NEVER write:
//   - reviewedBy, reviewedAt (human reviewer identity/timestamp)
//   - approvedBy, approvedAt (human approver identity/timestamp)
//   - human REVIEWED trust level
//   - a DocumentReview record (human review audit trail)
//   - validationStatus: "VALIDATED" (owned by the Document Validator — Gap 2)
//   - reviewStatus: "READY_FOR_EXPORT" (human review decision)
//
// Automation may only write:
//   - generationStatus: "GENERATED" (machine generation state)
//   - validationStatus: "PENDING" (awaiting canonical validation)
//   - reviewNotes with a `machine:` prefix (machine-repair provenance)
//   - fileContent, format, exactFileName, integrity fields (byte content)

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const exportGapRepair = readFileSync("lib/engine/export-gap-repair.ts", "utf8");
const repairRoute = readFileSync("app/api/tenders/[id]/repair-export-gaps/route.ts", "utf8");
const autoFinalizeRoute = readFileSync("app/api/tenders/[id]/auto-finalize/route.ts", "utf8");

describe("Gap 1 — export-gap-repair library never fabricates human state", () => {
  it("never writes reviewedBy or reviewedAt", () => {
    assert.doesNotMatch(exportGapRepair, /reviewedBy:\s*\w+/);
    assert.doesNotMatch(exportGapRepair, /reviewedAt:\s*new Date/);
  });

  it("never writes validationStatus: VALIDATED", () => {
    assert.doesNotMatch(exportGapRepair, /validationStatus:\s*"VALIDATED"/);
  });

  it("never writes reviewStatus: READY_FOR_EXPORT", () => {
    assert.doesNotMatch(exportGapRepair, /reviewStatus:\s*"READY_FOR_EXPORT"/);
  });

  it("never creates a DocumentReview record", () => {
    const stripped = exportGapRepair
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(stripped, /documentReview\.create/);
    assert.doesNotMatch(stripped, /DocumentReview\.create/);
  });

  it("writes a machine: prefix in reviewNotes for machine-repair provenance", () => {
    assert.match(exportGapRepair, /reviewNotes:\s*"machine:safe-export-repair/);
  });

  it("uses the machine: marker to skip already-repaired documents (idempotent)", () => {
    assert.match(exportGapRepair, /reviewNotes\.startsWith\("machine:safe-export-repair"\)/);
  });
});

describe("Gap 1 — repair-export-gaps route never fabricates human state", () => {
  it("never writes reviewedBy or reviewedAt", () => {
    assert.doesNotMatch(repairRoute, /reviewedBy:\s*\w+/);
    assert.doesNotMatch(repairRoute, /reviewedAt:\s*new Date/);
  });

  it("never writes validationStatus: VALIDATED", () => {
    assert.doesNotMatch(repairRoute, /validationStatus:\s*"VALIDATED"/);
  });

  it("never writes reviewStatus: READY_FOR_EXPORT", () => {
    assert.doesNotMatch(repairRoute, /reviewStatus:\s*"READY_FOR_EXPORT"/);
  });

  it("never creates a DocumentReview record", () => {
    const stripped = repairRoute
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(stripped, /documentReview\.create/);
    assert.doesNotMatch(stripped, /DocumentReview\.create/);
  });

  it("writes a machine: prefix in reviewNotes", () => {
    assert.match(repairRoute, /reviewNotes:\s*"machine:safe-export-repair/);
  });
});

describe("Gap 1 — auto-finalize route never fabricates human state", () => {
  // Strip comments. Then check only write patterns (data: { ... }) —
  // the route may still READ reviewedBy/reviewedAt in select clauses
  // for filtering/display, but must not WRITE them.
  const stripped = autoFinalizeRoute
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  it("never writes reviewedBy or reviewedAt in a data update", () => {
    // Check that no `data: { ... reviewedBy: ... ... }` pattern exists.
    // We look for reviewedBy/reviewedAt appearing after `data:` on the
    // same or nearby lines inside a generatedDocument.update call.
    assert.doesNotMatch(stripped, /data:\s*\{[^}]*reviewedBy:/s);
    assert.doesNotMatch(stripped, /data:\s*\{[^}]*reviewedAt:/s);
  });

  it("never writes validationStatus: VALIDATED in a data update", () => {
    assert.doesNotMatch(stripped, /validationStatus:\s*ready\s*\?\s*"VALIDATED"/);
    assert.doesNotMatch(stripped, /validationStatus:\s*"VALIDATED"/);
  });

  it("never writes reviewStatus: READY_FOR_EXPORT in a data update", () => {
    assert.doesNotMatch(stripped, /reviewStatus:\s*ready\s*\?\s*"READY_FOR_EXPORT"/);
  });

  it("never creates a DocumentReview record", () => {
    assert.doesNotMatch(stripped, /documentReview\.create/);
  });

  it("writes validationStatus: PENDING (awaiting Document Validator)", () => {
    assert.match(autoFinalizeRoute, /validationStatus:\s*"PENDING"/);
  });

  it("writes a machine: prefix in reviewNotes", () => {
    assert.match(autoFinalizeRoute, /machine:auto-finalize/);
  });
});
