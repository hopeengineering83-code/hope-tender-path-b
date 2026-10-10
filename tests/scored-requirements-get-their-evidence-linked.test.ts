// 2026-09-28, accept run 36456526332: after the validated proposal existed,
// the automatic coverage sync still left every SCORED requirement ("Cover
// Letter", "Technical Approach and Methodology") on its engine-time PARTIAL,
// because it loaded only MANDATORY/CRITICAL requirements. It now links
// evidence for every grounded requirement, while only mandatory/critical ones
// can be reported as ungrounded, as evidence gaps or as package violations —
// the lists Run Engine and auto-finalize block on.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("lib/engine/automatic-requirement-coverage.ts", "utf8");
const loader = source.slice(source.indexOf("async function loadCoverageContext"), source.indexOf("files: {", source.indexOf("async function loadCoverageContext")));
const desired = source.slice(source.indexOf("function desiredRowsForContext"), source.indexOf("function vaultRecordCandidate"));

describe("scored requirements get their evidence linked", () => {
  it("loads every requirement, not only mandatory ones", () => {
    assert.match(loader, /requirements: \{/);
    assert.doesNotMatch(loader, /priority: \{ in: \["MANDATORY", "CRITICAL"\] \}/);
  });

  it("reports only mandatory/critical requirements as blocking", () => {
    assert.match(desired, /const blocking = \["MANDATORY", "CRITICAL"\]\.includes/);
    assert.match(desired, /if \(blocking\) remainingUngrounded\.push/);
    assert.match(desired, /if \(blocking\) remainingWithoutEligibleEvidence\.push/);
    assert.match(desired, /\} else if \(!blocking\) \{[\s\S]*?\} else if \(conformance\.status === "VIOLATED"\)/);
  });
});
