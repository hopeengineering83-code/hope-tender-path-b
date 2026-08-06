// ─── Regression: no hardcoded workflow boolean values in tender page ──────────
//
// Ensures that sourceIntegrityValid, engineRunning, and engineComplete
// are derived from truthful database/job state — never hardcoded as
// literal `true` or `false` in the JSX.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const page = readFileSync("app/dashboard/tenders/[id]/page.tsx", "utf8");

function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("truthful workflow state — no hardcoded booleans", () => {
  it("sourceIntegrityValid is derived from file extraction state, not hardcoded", () => {
    const src = codeOnly(page);
    // Must NOT have sourceIntegrityValid={true} or sourceIntegrityValid={false}
    assert.doesNotMatch(src, /sourceIntegrityValid=\{true\}/);
    assert.doesNotMatch(src, /sourceIntegrityValid=\{false\}/);
    // Must derive from file extraction scores
    assert.match(src, /sourceIntegrityValid\s*=\s*tender\.files/);
  });

  it("engineRunning is derived from active Engine job, not hardcoded", () => {
    const src = codeOnly(page);
    assert.doesNotMatch(src, /engineRunning=\{false\}/);
    assert.doesNotMatch(src, /engineRunning=\{true\}/);
    assert.match(src, /engineRunning\s*=\s*Boolean\(activeEngineJob\)/);
  });

  it("engineComplete is derived from succeeded Engine job, not hardcoded", () => {
    const src = codeOnly(page);
    assert.doesNotMatch(src, /engineComplete=\{false\}/);
    assert.doesNotMatch(src, /engineComplete=\{true\}/);
    assert.match(src, /engineComplete\s*=\s*Boolean\(succeededEngineJob\)/);
  });

  it("extractionComplete is derived from file extraction scores, not hardcoded", () => {
    const src = codeOnly(page);
    assert.doesNotMatch(src, /extractionComplete=\{true\}/);
    assert.doesNotMatch(src, /extractionComplete=\{false\}/);
    assert.match(src, /extractionComplete\s*=\s*tender\.files\.some/);
  });

  it("analysisComplete is derived from succeeded AI_ANALYZE job + analysisExtractionStatus", () => {
    const src = codeOnly(page);
    assert.match(src, /analysisComplete\s*=\s*Boolean\(succeededAnalysisJob\)/);
    assert.match(src, /FULL_EXTRACTION_AI_ANALYZED/);
  });

  it("the page queries for active and succeeded ENGINE_RUN jobs", () => {
    const src = codeOnly(page);
    assert.match(src, /jobType:\s*"ENGINE_RUN"/);
    assert.match(src, /status:\s*\{\s*in:\s*\["QUEUED",\s*"RUNNING"\]\s*\}/);
    assert.match(src, /activeEngineJob/);
    assert.match(src, /succeededEngineJob/);
  });

  it("the page queries for succeeded AI_ANALYZE job with analysisInputHash", () => {
    const src = codeOnly(page);
    // The succeededAnalysisJob query must include analysisInputHash for
    // revision invalidation (stale detection).
    assert.match(src, /analysisInputHash:\s*true/);
  });
});
