import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

// The client-side enqueue/poll cases were removed with
// components/engine-action-panel.tsx. Browser polling was never what made
// the run durable — the ENGINE_RUN worker is, and that is asserted below.
describe("Engine background-run availability", () => {
  const route = read("app/api/tenders/[id]/engine/route.ts");
  const worker = read("lib/ai-job-handlers.ts");

  it("always persists an ENGINE_RUN job and returns accepted status", () => {
    assert.match(route, /enqueueEngineJobForCurrentSources/);
    assert.match(route, /jobId: enqueueResult\.id/);
    assert.match(route, /persistedStatus: enqueueResult\.status/);
    assert.match(route, /statusEndpoint: `\/api\/ai-jobs\/\$\{enqueueResult\.id\}`/);
    assert.match(route, /\}, \{ status: 202 \}\)/);
    assert.doesNotMatch(route, /runTenderEngine\(/);
  });




  it("registers the ENGINE_RUN worker and revalidates source authority before and after execution", () => {
    assert.match(worker, /jobType === "ENGINE_RUN"/);
    assert.match(worker, /assertCurrentEngineSourceRevision/);
    assert.match(worker, /ENGINE_SOURCE_REVISION_STALE/);
    assert.match(worker, /checkpoint: "before"/);
    assert.match(worker, /checkpoint: "after"/);
    assert.match(worker, /reconcileAutomaticRequirementCoverage/);
    assert.match(worker, /buildAndVerifyBuildPlan/);
  });
});
