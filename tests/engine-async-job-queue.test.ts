// Regression tests for the background engine flow and honest partial results.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("Engine route — async mode actually enqueues a job", () => {
  const route = read("app/api/tenders/[id]/engine/route.ts");

  it("imports enqueueJob and findActiveEngineRunForTender", () => {
    assert.match(route, /import \{ enqueueJob, findActiveEngineRunForTender \} from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/lib\/ai-jobs"/);
  });

  it("checks ?async=true and returns 202 with a real jobId", () => {
    assert.match(route, /searchParams\.get\("async"\) === "true"/);
    assert.match(route, /findActiveEngineRunForTender\(id, userId\)/);
    assert.match(route, /jobType: "ENGINE_RUN"/);
    assert.match(route, /jobId,\s*status: "QUEUED"/);
    assert.match(route, /status: 202/);
  });

  it("async branch runs after extraction and analysis validation", () => {
    const asyncPos = route.indexOf('searchParams.get("async") === "true"');
    const noFilesPos = route.indexOf("NO_TENDER_FILES");
    const ocrPos = route.indexOf("ANALYSIS_FROM_CORRUPTED_EXTRACTION");
    const weakPos = route.indexOf("ANALYSIS_FROM_WEAK_EXTRACTION");
    assert.ok(asyncPos > noFilesPos && asyncPos > ocrPos && asyncPos > weakPos);
  });

  it("normalizes safe/skipAiRematch/maxChars query input", () => {
    const asyncSlice = route.slice(route.indexOf('searchParams.get("async") === "true"'));
    assert.match(asyncSlice, /searchParams\.get\("safe"\) === "true"/);
    assert.match(asyncSlice, /searchParams\.get\("skipAiRematch"\) === "true"/);
    assert.match(asyncSlice, /Number\(maxCharsParam\)/);
  });

  it("preserves the synchronous path when async is not requested", () => {
    assert.match(route, /const deadlineAt = Date\.now\(\) \+ 50_000/);
    assert.match(route, /runTenderEngine\(id, userId, undefined, \{ deadlineAt \}\)/);
  });
});

describe("Engine action panel — async SUCCEEDED branch surfaces partial results honestly", () => {
  const src = read("components/engine-action-panel.tsx");
  const succeededPos = src.indexOf('if (finalStatus === "SUCCEEDED")');
  const failedPos = src.indexOf('else if (finalStatus === "FAILED")');

  it("reads finalJob.output", () => {
    const succeededSlice = src.slice(succeededPos, failedPos);
    assert.match(succeededSlice, /const jobOutput = finalJob\?\.output/);
    assert.match(succeededSlice, /jobOutput\?\.result \?\? jobOutput/);
  });

  it("recognizes both partial-result shapes", () => {
    const succeededSlice = src.slice(succeededPos, failedPos);
    assert.match(succeededSlice, /engineResult\?\.partial === true \|\| engineResult\?\.code === "ENGINE_COMPLETED_WITH_BLOCKERS"/);
  });

  it("checks partial output before publishing any success result", () => {
    const isPartialPos = src.indexOf("if (isPartial)");
    const successResultPos = src.indexOf("success: true", isPartialPos);
    assert.ok(isPartialPos > succeededPos && isPartialPos < failedPos);
    assert.ok(successResultPos > isPartialPos && successResultPos < failedPos);
    const partialSlice = src.slice(isPartialPos, successResultPos);
    assert.match(partialSlice, /success: false/);
    assert.match(partialSlice, /blockers: Array\.isArray\(rawBlockers\) \? rawBlockers : undefined/);
    assert.match(partialSlice, /matching is blocked/i);
  });
});