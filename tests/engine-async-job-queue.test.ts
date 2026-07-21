// Regression tests for the broken "Run Engine (Safe Mode)" / "Run in
// background" flow.
//
// Root cause (confirmed via a real Postgres + real Next.js dev server run):
// app/api/tenders/[id]/engine/route.ts never implemented async/job-queue
// mode despite components/engine-action-panel.tsx's executeEngineRunAsync
// fully expecting it — it POSTs with ?async=true and expects a 202 + jobId
// to poll. Every "background" click silently ran the SAME synchronous path,
// which never returns a jobId, so the client's `!enqueueData.jobId` guard
// immediately passed the raw synchronous API response straight to the UI.
// That raw shape has no top-level `error` field on a partial-success
// response, so the panel rendered the generic "Engine failed." fallback for
// what was often a legitimate partial success — and large-vault background
// runs never actually escaped the 60s Vercel function cap this mode exists
// to provide.
//
// A second, adjacent gap: even after wiring the enqueue, a background job
// that reaches AiJob status SUCCEEDED does not mean the engine run was a
// full success — the ENGINE_RUN handler returns (without throwing) two
// honest-but-partial shapes: `{ result: { partial: true, blockers, ... } }`
// (AI rematch skipped/failed) and `{ code: "ENGINE_COMPLETED_WITH_BLOCKERS",
// blockers, ... }` (postcondition check failed, e.g. zero evidence rows).
// The client's SUCCEEDED branch used to unconditionally show a plain
// "Engine completed successfully" message, discarding that output entirely.

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
    assert.match(route, /NextResponse\.json\(\{ jobId, status: "QUEUED", diagnosticId \}, \{ status: 202 \}\)/);
  });

  it("async branch runs AFTER all existing blocking validation (extraction/analysis gates still apply synchronously)", () => {
    const asyncPos = route.indexOf('searchParams.get("async") === "true"');
    const noFilesPos = route.indexOf("NO_TENDER_FILES");
    const ocrPos = route.indexOf("ANALYSIS_FROM_CORRUPTED_EXTRACTION");
    const weakPos = route.indexOf("ANALYSIS_FROM_WEAK_EXTRACTION");
    assert.ok(asyncPos > -1, "async branch must exist");
    assert.ok(noFilesPos > -1 && asyncPos > noFilesPos, "async check must come after the NO_TENDER_FILES gate");
    assert.ok(ocrPos > -1 && asyncPos > ocrPos, "async check must come after the corrupted-extraction gate");
    assert.ok(weakPos > -1 && asyncPos > weakPos, "async check must come after the weak-extraction gate");
  });

  it("async branch reads safe/skipAiRematch/maxChars from query params and passes booleans/numbers (not strings) as job input", () => {
    const asyncSlice = route.slice(route.indexOf('searchParams.get("async") === "true"'));
    assert.match(asyncSlice, /searchParams\.get\("safe"\) === "true"/);
    assert.match(asyncSlice, /searchParams\.get\("skipAiRematch"\) === "true"/);
    assert.match(asyncSlice, /searchParams\.get\("maxChars"\)/);
    // Guards against a regression that stores maxChars as the raw string.
    assert.match(asyncSlice, /Number\(maxCharsParam\)/);
  });

  it("still runs the existing synchronous path unchanged when async is not requested", () => {
    assert.match(route, /const deadlineAt = Date\.now\(\) \+ 50_000/);
    assert.match(route, /runTenderEngine\(id, userId, undefined, \{ deadlineAt \}\)/);
  });
});

describe("Engine action panel — async SUCCEEDED branch surfaces partial results honestly", () => {
  const src = read("components/engine-action-panel.tsx");

  it("reads finalJob.output (previously ignored entirely on SUCCEEDED)", () => {
    const succeededPos = src.indexOf('if (finalStatus === "SUCCEEDED")');
    const failedPos = src.indexOf('else if (finalStatus === "FAILED")');
    assert.ok(succeededPos > -1 && failedPos > succeededPos);
    const succeededSlice = src.slice(succeededPos, failedPos);
    assert.match(succeededSlice, /const jobOutput = finalJob\?\.output/);
    assert.match(succeededSlice, /jobOutput\?\.result \?\? jobOutput/);
  });

  it("treats both partial shapes (nested result.partial and top-level ENGINE_COMPLETED_WITH_BLOCKERS) as partial, not success", () => {
    const succeededPos = src.indexOf('if (finalStatus === "SUCCEEDED")');
    const failedPos = src.indexOf('else if (finalStatus === "FAILED")');
    const succeededSlice = src.slice(succeededPos, failedPos);
    assert.match(succeededSlice, /engineResult\?\.partial === true \|\| engineResult\?\.code === "ENGINE_COMPLETED_WITH_BLOCKERS"/);
  });

  it("partial branch sets success:false and includes the real blockers, before the plain-success message", () => {
    const succeededPos = src.indexOf('if (finalStatus === "SUCCEEDED")');
    const failedPos = src.indexOf('else if (finalStatus === "FAILED")');
    const plainSuccessPos = src.indexOf("Engine completed successfully (background)");
    const isPartialPos = src.indexOf("if (isPartial)");
    assert.ok(isPartialPos > succeededPos && isPartialPos < failedPos, "isPartial check must be inside the SUCCEEDED branch");
    assert.ok(isPartialPos < plainSuccessPos, "partial check must come BEFORE the plain success message");
    const partialSlice = src.slice(isPartialPos, plainSuccessPos);
    assert.match(partialSlice, /success: false/);
    assert.match(partialSlice, /blockers: Array\.isArray\(rawBlockers\) \? rawBlockers : undefined/);
    assert.match(partialSlice, /Engine completed partially \(background\)\./);
  });
});
