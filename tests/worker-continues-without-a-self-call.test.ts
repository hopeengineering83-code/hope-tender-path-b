// A continuation must not depend on the deployment being allowed to call
// itself.
//
// The worker handed each stage to the next over HTTP: run-next POSTs its own
// /api/ai-jobs/dispatch, which POSTs its own /api/ai-jobs/run-next. Two hops
// per stage, all on one request chain, all re-entering the same deployment —
// and the platform refuses such a chain once it is deep enough. Vercel answers
// 508 INFINITE_LOOP_DETECTED.
//
// Observed end to end on the exact head, on the owner's real tender:
//
//   21:16:19  POST .../engine                      202   (Run Engine)
//   21:16:32  ENGINE_RUN            ran, succeeded
//   21:17:21  PROPOSAL_GENERATION   ran, proposal v5 saved, 3 CVs generated
//   21:18:07  [worker-wake] durable stage remains queued because the
//             dispatcher nudge was rejected  jobType=AUTO_FINALIZE status=508
//
// and then nothing, ever. AUTO_FINALIZE stayed QUEUED with no claimant: no
// cron drains the durable queue on this plan, no UI control nudges the worker,
// and the tender page polls read-only endpoints. The owner was left on a
// workflow that says it is running automatically, one stage short of a ZIP.
//
// The invocation that gave up had finished generation 46 seconds into a
// 300-second budget. It had the time; it had simply pinned itself to one
// jobType and required a network round trip to itself to take the next one.
//
// What is pinned here: the worker advances to the stage it just enqueued
// inside the same invocation while budget remains, the HTTP wake survives only
// as the genuine out-of-time hand-off, and neither path can reach a manual
// gate.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const runNext = readFileSync("app/api/ai-jobs/run-next/route.ts", "utf8");

/** Strip comments so prose describing the defect is never itself a hit. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const runNextCode = code(runNext);

/** The claim loop body, from the `while` to the closing of the stage branch. */
function claimLoop(): string {
  const start = runNextCode.indexOf("while (Date.now() - startTime < maxRunMs)");
  assert.ok(start > -1, "the claim loop must still exist");
  const end = runNextCode.indexOf("if (processedJobs.length === 0)");
  assert.ok(end > start, "the claim loop must still end before the empty-queue reply");
  return runNextCode.slice(start, end);
}

describe("the worker continues without a self-call", () => {
  it("claims against a stage that can advance, not one fixed for the whole run", () => {
    // The loop was pinned to `parsedJobType.value`, the filter the waking
    // request supplied. A job enqueued mid-invocation could therefore never be
    // claimed by that invocation, however much budget was left.
    assert.match(runNextCode, /let activeJobType = parsedJobType\.value/);
    assert.match(claimLoop(), /jobType: activeJobType/);
    assert.doesNotMatch(
      claimLoop(),
      /jobType: parsedJobType\.value/,
      "the claim must read the advanceable stage, not the caller's fixed filter",
    );
  });

  it("advances to the stage it just enqueued instead of ending the invocation", () => {
    const loop = claimLoop();
    assert.match(loop, /activeJobType = continuation/);
    assert.match(
      loop,
      /continuation === "PROPOSAL_GENERATION" \|\| continuation === "AUTO_FINALIZE"/,
      "only the two automatic post-Engine stages may be continued into",
    );
    // The successor is the one this iteration actually enqueued — read back
    // from the job just recorded, and only when it is that same job. Guessing
    // a successor, or inheriting one from an earlier iteration, would claim
    // work this stage never authorised.
    assert.match(loop, /justProcessed\?\.jobId === claimed\.id/);
    assert.match(loop, /justProcessed\.nextJobType/);
  });

  it("still refuses to start a stage it cannot finish", () => {
    // Continuing in-invocation must obey the same budget floor as any other
    // claim. Without this, a continuation could start with seconds left and
    // die mid-stage — trading a stall for a corrupted run, which is worse.
    const loop = claimLoop();
    assert.match(loop, /roomForContinuation = absoluteDeadline - Date\.now\(\) >= MINIMUM_REMAINING_BUDGET_MS/);
    assert.match(loop, /&& roomForContinuation\)/);
    assert.match(loop, /\}\s*\n\s*break;/, "a stage with no continuation must still end the loop");
  });

  it("keeps the HTTP wake for the out-of-time hand-off only", () => {
    // The wake is still correct when the invocation genuinely runs out of
    // budget: a fresh invocation is exactly what is needed then, and a fresh
    // request is a fresh chain. It must not be the only path.
    assert.match(runNextCode, /scheduleRequestScopedWorkerWake\(req, continuationJobType\)/);
  });

  it("does not nudge a stage this invocation already ran", () => {
    // Once the loop can run PROPOSAL_GENERATION and AUTO_FINALIZE in one
    // invocation, the post-loop hand-off sees AUTO_FINALIZE listed as a
    // successor of a job that has already been run here. Nudging it finds
    // nothing to claim, and when the platform refuses the self-call it logs
    // "durable stage remains queued" for a stage that finished — the false
    // alarm that made a genuinely stuck pipeline hard to identify.
    assert.match(runNextCode, /const stagesRunHere = new Set\(processedJobs\.map\(\(job\) => job\.jobType\)\)/);
    assert.match(runNextCode, /&& !stagesRunHere\.has\(type\)/);
  });

  it("cannot reach either manual gate by continuing", () => {
    // Absolute. AI Analyze and Run Engine are the owner's two deliberate
    // gates. A continuation carries forward authority the owner already gave
    // for work already enqueued; it may never manufacture a new gate crossing.
    const loop = claimLoop();
    const advance = loop.slice(loop.indexOf("const justProcessed"));
    assert.doesNotMatch(
      advance,
      /"AI_ANALYZE"|"ENGINE_RUN"/,
      "the in-invocation advance must never target a manual gate",
    );
  });
});

describe("a rerun after a successful proposal advances instead of dead-ending", () => {
  // The services these assertions guard are proven against real rows in
  // tests/rerun-after-successful-proposal-db.test.ts. What is pinned here is
  // the wiring: that the worker acts on the state the continuation reports
  // rather than on `queued` alone, which is what left the owner's tender one
  // stage short of a ZIP with nothing logged as wrong.

  it("continues to AUTO_FINALIZE when generation already succeeded", () => {
    assert.match(runNextCode, /continuation\.state === "ALREADY_SUCCEEDED"/);
    const branch = runNextCode.slice(runNextCode.indexOf('continuation.state === "ALREADY_SUCCEEDED"'));
    const body = branch.slice(0, branch.indexOf("} else if"));
    assert.match(body, /ensureAutoFinalizeContinuationJob\(/);
    assert.match(body, /nextJobType = "AUTO_FINALIZE"/);
    assert.doesNotMatch(
      body,
      /nextJobType = "PROPOSAL_GENERATION"/,
      "re-running generation to manufacture a claimable job would duplicate the proposal",
    );
  });

  it("never treats an unclaimable stage as claimable", () => {
    // `claimable` is the only thing that may put a stage in nextJobType. A
    // SUCCEEDED or RUNNING row reported as claimable is the original defect.
    assert.match(runNextCode, /if \(finalize\.claimable\) \{/);
    assert.match(runNextCode, /finalize\.state === "ALREADY_SUCCEEDED"/);
    assert.match(runNextCode, /PIPELINE_ALREADY_COMPLETE/);
  });

  it("enqueues the finalize successor idempotently, not with a bare create", () => {
    const branch = runNextCode.slice(runNextCode.indexOf('claimed.jobType === "PROPOSAL_GENERATION"'));
    const body = branch.slice(0, branch.indexOf("processedJobs.push"));
    assert.match(body, /ensureAutoFinalizeContinuationJob\(/);
    assert.doesNotMatch(
      body,
      /enqueueJob\(/,
      "a bare enqueue mints a second AUTO_FINALIZE row on every rerun",
    );
  });
});
