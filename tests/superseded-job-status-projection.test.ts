// P0 #2, read side: a SUPERSEDED analysis must not be projected to a client as
// still pending.
//
// Supersession is a real terminal status — analysis-orchestrator writes
// status: "SUPERSEDED" when a job loses a promotion race, and
// tests/p0-analysis-authority-closure.test.ts proves the loser reaches that
// state and never promotes. That covers the WRITE side.
//
// This covers the READ side. /api/jobs/[jobId] maps AiJob.status onto a legacy
// four-value enum for polling clients. Its mapping had no SUPERSEDED branch, so
// the value fell through to the PENDING default: a dead job reported as still
// queued. A client polling that endpoint would wait on work that could never
// progress, and the UI would show analysis in flight after it had already
// ended.
//
// DONE would be worse than PENDING here — DONE reads as a usable result, and a
// superseded analysis must never authorise anything downstream. Among the four
// legacy values FAILED is the only honest one: terminal, and explicitly not a
// success.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { ANALYSIS_SUPERSEDED_STATUS } from "../lib/ai-analyze-promotion";

// The mapping is module-private, so exercise it exactly as the route defines it
// by evaluating the same source. This keeps the test honest: it fails if the
// route's own function changes, not if a copy in the test drifts.
function loadLegacyStatus(): (status: string) => string {
  const source = readFileSync("app/api/jobs/[jobId]/route.ts", "utf8");
  const match = source.match(/function legacyStatus\(status: string\)[\s\S]*?\n\}/);
  assert.ok(match, "legacyStatus must still exist in app/api/jobs/[jobId]/route.ts");
  const body = match![0]
    .replace(/: string/g, "")
    .replace(/: "PENDING" \| "RUNNING" \| "DONE" \| "FAILED"/, "")
    .replace(/ANALYSIS_SUPERSEDED_STATUS/g, JSON.stringify(ANALYSIS_SUPERSEDED_STATUS));
  // eslint-disable-next-line no-new-func
  return new Function(`${body}; return legacyStatus;`)() as (status: string) => string;
}

describe("legacy job-status projection — superseded is terminal", () => {
  const legacyStatus = loadLegacyStatus();

  it("never reports a superseded analysis as pending", () => {
    assert.notEqual(
      legacyStatus(ANALYSIS_SUPERSEDED_STATUS),
      "PENDING",
      "a superseded job is dead; reporting it pending makes a polling client wait forever",
    );
  });

  it("never reports a superseded analysis as done", () => {
    assert.notEqual(
      legacyStatus(ANALYSIS_SUPERSEDED_STATUS),
      "DONE",
      "DONE reads as a usable result — a superseded analysis must never authorise downstream work",
    );
  });

  it("reports it as a terminal, unsuccessful state", () => {
    assert.equal(legacyStatus(ANALYSIS_SUPERSEDED_STATUS), "FAILED");
  });

  it("leaves the other mappings intact", () => {
    assert.equal(legacyStatus("SUCCEEDED"), "DONE");
    assert.equal(legacyStatus("PARTIAL_SUCCESS"), "DONE");
    assert.equal(legacyStatus("FAILED"), "FAILED");
    assert.equal(legacyStatus("CANCELED"), "FAILED");
    assert.equal(legacyStatus("RUNNING"), "RUNNING");
    assert.equal(legacyStatus("QUEUED"), "PENDING");
  });
});
