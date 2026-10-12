// ─── Regression: no hardcoded workflow boolean values in tender page ──────────
//
// Ensures that sourceIntegrityValid, engineRunning, and engineComplete
// are derived from truthful database/job state — never hardcoded as
// literal `true` or `false` in the JSX.
//
// FIX 7: After the canonical-readiness refactor, the page no longer derives
// these booleans from raw per-file `extractionScore` checks or unscoped
// `succeededAnalysisJob`/`succeededEngineJob` queries. The single canonical
// readiness service (getCanonicalTenderReadiness) is the only source of
// truth. These tests verify the new architecture is in place AND that no
// hardcoded booleans remain.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const page = readFileSync("app/dashboard/tenders/[id]/page.tsx", "utf8");

function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("truthful workflow state — no hardcoded booleans", () => {
  it("sourceIntegrityValid is derived from canonical readiness, not hardcoded", () => {
    const src = codeOnly(page);
    // Must NOT have sourceIntegrityValid={true} or sourceIntegrityValid={false}
    assert.doesNotMatch(src, /sourceIntegrityValid=\{true\}/);
    assert.doesNotMatch(src, /sourceIntegrityValid=\{false\}/);
    // FIX 7: Must derive from the canonical readiness service, not from
    // raw tender.files.every(...) extractionScore checks.
    assert.match(src, /sourceIntegrityValid\s*=\s*Boolean\(canonicalReadiness/);
    assert.doesNotMatch(
      src,
      /sourceIntegrityValid\s*=\s*tender\.files/,
      "FIX 7: sourceIntegrityValid must NOT be derived from raw tender.files checks (legacy)",
    );
  });

  it("engineRunning is derived from active Engine job AND canonical readiness, not hardcoded", () => {
    const src = codeOnly(page);
    assert.doesNotMatch(src, /engineRunning=\{false\}/);
    assert.doesNotMatch(src, /engineRunning=\{true\}/);
    // FIX 7: engineRunning now combines the activeEngineJob indicator with
    // the canonical matching module state (engineComplete).
    assert.match(src, /engineRunning\s*=\s*Boolean\(activeEngineJob\)/);
  });

  it("engineComplete is derived from canonical readiness matching module, not hardcoded", () => {
    const src = codeOnly(page);
    assert.doesNotMatch(src, /engineComplete=\{false\}/);
    assert.doesNotMatch(src, /engineComplete=\{true\}/);
    // FIX 7: engineComplete now derives from the canonical matching module
    // state (READY/WARNING), not from a raw succeededEngineJob query.
    assert.match(src, /engineComplete\s*=.*matchingModuleState/);
    assert.doesNotMatch(
      src,
      /engineComplete\s*=\s*Boolean\(succeededEngineJob\)/,
      "FIX 7: engineComplete must NOT be derived from raw succeededEngineJob query (legacy)",
    );
  });

  it("extractionComplete is derived from canonical readiness extraction module, not hardcoded", () => {
    const src = codeOnly(page);
    assert.doesNotMatch(src, /extractionComplete=\{true\}/);
    assert.doesNotMatch(src, /extractionComplete=\{false\}/);
    // FIX 7: extractionComplete now derives from the canonical extraction
    // module state, not from raw tender.files.some(...) extractionScore checks.
    assert.match(src, /extractionComplete\s*=.*extractionModuleState/);
    assert.doesNotMatch(
      src,
      /extractionComplete\s*=\s*tender\.files\.some/,
      "FIX 7: extractionComplete must NOT be derived from raw tender.files.some() (legacy)",
    );
  });

  it("analysisComplete is derived from canonical readiness analysis module", () => {
    const src = codeOnly(page);
    // FIX 7: analysisComplete now derives from the canonical analysis module
    // state, not from raw succeededAnalysisJob + analysisExtractionStatus.
    assert.match(src, /analysisComplete\s*=.*analysisModuleState/);
    assert.doesNotMatch(
      src,
      /analysisComplete\s*=\s*Boolean\(succeededAnalysisJob\)/,
      "FIX 7: analysisComplete must NOT be derived from raw succeededAnalysisJob (legacy)",
    );
  });

  it("the page queries for active (QUEUED/RUNNING) ENGINE_RUN and AI_ANALYZE jobs for the in-flight indicator", () => {
    const src = codeOnly(page);
    // FIX 7: The page still queries for active (QUEUED/RUNNING) jobs to
    // surface the "in-flight" indicator. But it no longer queries for
    // SUCCEEDED jobs as a workflow authority — that's the canonical
    // readiness service's job.
    assert.match(src, /jobType:\s*"ENGINE_RUN"/);
    assert.match(src, /status:\s*\{\s*in:\s*\["QUEUED",\s*"RUNNING"\]\s*\}/);
    assert.match(src, /activeEngineJob/);
    assert.match(src, /activeAnalysisJob/);
  });

  it("FIX 7: the page no longer queries for unscoped succeededAnalysisJob or succeededEngineJob rows", () => {
    const src = codeOnly(page);
    // These unscoped queries were the legacy readiness source. They must be
    // gone — the canonical readiness service is the single source of truth.
    assert.doesNotMatch(
      src,
      /succeededAnalysisJob/,
      "FIX 7: page must NOT query succeededAnalysisJob (legacy — use canonical readiness)",
    );
    assert.doesNotMatch(
      src,
      /succeededEngineJob/,
      "FIX 7: page must NOT query succeededEngineJob (legacy — use canonical readiness)",
    );
  });

  it("FIX 7: the page imports and calls getCanonicalTenderReadiness as the single workflow authority", () => {
    const src = codeOnly(page);
    assert.match(src, /getCanonicalTenderReadiness/);
    assert.match(src, /canonicalReadiness/);
  });
});
